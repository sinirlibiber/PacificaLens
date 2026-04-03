'use client';
/**
 * HeatmapView — Estimated Liquidation Heatmap (inline, not a modal)
 *
 * Uses candle wick data to estimate liquidation zones:
 *   - Upper wicks  → likely SHORT liquidation clusters (red/orange)
 *   - Lower wicks  → likely LONG  liquidation clusters (teal/green)
 *   - Volume-weighted intensity
 *   - Price line overlay
 *   - Crosshair + tooltip
 *
 * Controls:
 *   - Coin selector (all 63 Pacifica markets)
 *   - Range: 12h / 24h / 48h / 7d
 *   - Side: All / Long / Short
 *   - Volume bar sub-chart
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Market } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { useLiquidationHeatmap } from '@/hooks/useLiquidationHeatmap';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }

interface HeatmapViewProps {
  markets: Market[];
  defaultSymbol?: string;
}

// ── Color scales ──────────────────────────────────────────────────────────────
function shortColor(v: number): string {
  if (v <= 0) return 'transparent';
  type S = [number, number, number, number, number];
  const stops: S[] = [
    [0,    60,   0,   0, 0.12],
    [0.15, 140,  10,   0, 0.35],
    [0.35, 210,  60,   0, 0.58],
    [0.55, 245, 130,   0, 0.72],
    [0.75, 255, 200,   0, 0.86],
    [0.90, 255, 235,  80, 0.94],
    [1,    255, 255, 200, 1   ],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = lo[0] === hi[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return `rgba(${Math.round(lerp(lo[1],hi[1]))},${Math.round(lerp(lo[2],hi[2]))},${Math.round(lerp(lo[3],hi[3]))},${lerp(lo[4],hi[4]).toFixed(2)})`;
}

function longColor(v: number): string {
  if (v <= 0) return 'transparent';
  type S = [number, number, number, number, number];
  const stops: S[] = [
    [0,     0,  25,  50, 0.12],
    [0.15,  0,  80, 110, 0.35],
    [0.35,  0, 175, 165, 0.58],
    [0.55,  0, 215,  95, 0.72],
    [0.75, 80, 235,  45, 0.86],
    [0.90,185, 245,  35, 0.94],
    [1,   225, 255, 110, 1   ],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = lo[0] === hi[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return `rgba(${Math.round(lerp(lo[1],hi[1]))},${Math.round(lerp(lo[2],hi[2]))},${Math.round(lerp(lo[3],hi[3]))},${lerp(lo[4],hi[4]).toFixed(2)})`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(p: number) {
  if (p >= 10000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1)     return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.001) return '$' + p.toPrecision(4);
  return '$' + p.toExponential(3);
}
function fmtUSD(v: number) {
  return v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M`
       : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K`
       : `$${v.toFixed(0)}`;
}
function intensityLabel(v: number) {
  if (v > 0.85) return 'Extreme';
  if (v > 0.65) return 'Very High';
  if (v > 0.45) return 'High';
  if (v > 0.25) return 'Medium';
  return 'Low';
}

// ── Config ────────────────────────────────────────────────────────────────────
const TIME_RANGES = [
  { label: '12h', hours: 12,  interval: '15m', intervalMs: 15 * 60 * 1000 },
  { label: '24h', hours: 24,  interval: '1h',  intervalMs: 60 * 60 * 1000 },
  { label: '48h', hours: 48,  interval: '1h',  intervalMs: 60 * 60 * 1000 },
  { label: '7d',  hours: 168, interval: '4h',  intervalMs: 4 * 60 * 60 * 1000 },
];
type SideMode = 'all' | 'long' | 'short';
const ROWS     = 120;
const LEGEND_W = 88;
const VOL_H    = 40; // volume sub-chart height

// ── Component ─────────────────────────────────────────────────────────────────
export default function HeatmapView({ markets, defaultSymbol }: HeatmapViewProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const volRef     = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const [symbol,   setSymbol  ] = useState<string>(defaultSymbol ?? '');
  const [rangeIdx, setRangeIdx] = useState(1); // default 24h
  const [sideMode, setSideMode] = useState<SideMode>('all');
  const [loading,  setLoading ] = useState(false);
  const [error,    setError   ] = useState('');
  const [candles,  setCandles ] = useState<Candle[]>([]);
  const [stats,    setStats   ] = useState({ currentPrice: 0, highPrice: 0, lowPrice: 0, change24h: 0, vol24h: 0 });
  const [searchQ,  setSearchQ ] = useState('');
  const [dropOpen, setDropOpen] = useState(false);

  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    date: string; price: string;
    liqVol: number; side: string; intensity: string;
    volUsd: number;
  } | null>(null);

  const isDark = typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark');

  // Gerçek liq verisi olan semboller (Hyperliquid + Binance'te mevcut olanlar)
  const { data: liqData, loading: liqLoading } = useLiquidationHeatmap(markets);
  const supportedSymbols = new Set(
    liqData.filter(d => d.hasRealData).map(d => d.symbol.replace(/-USD$/i, '').toUpperCase())
  );
  const hasLiveData = supportedSymbols.has(symbol.replace(/-USD$/i, '').toUpperCase());

  // pick first market on load
  useEffect(() => {
    if (!symbol && markets.length > 0) setSymbol(markets[0].symbol);
  }, [markets, symbol]);

  const metaRef = useRef({
    minP: 0, maxP: 0, minT: 0, maxT: 0, COLS: 0,
    cellW: 0, cellH: 0, W: 0, H: 0,
    shortGrid: [] as number[][],
    longGrid:  [] as number[][],
    colShortTotal: [] as number[],
    colLongTotal:  [] as number[],
    colVol:        [] as number[],
    candles:       [] as Candle[],
  });

  // ── Draw heatmap ──────────────────────────────────────────────────────────
  const draw = useCallback((candleData: Candle[], side: SideMode) => {
    const canvas = canvasRef.current;
    if (!canvas || !candleData.length) { setLoading(false); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width - LEGEND_W;
    const H = canvas.height;
    ctx.clearRect(0, 0, canvas.width, H);

    // Price range
    const highs = candleData.map(c => parseFloat(c.h));
    const lows  = candleData.map(c => parseFloat(c.l));
    let maxP = Math.max(...highs);
    let minP = Math.min(...lows);
    const pad = (maxP - minP) * 0.12;
    maxP += pad; minP -= pad;

    const times = candleData.map(c => (c.t > 1e12 ? c.t : c.t * 1000));
    const minT  = Math.min(...times);
    const maxT  = Math.max(...times);
    const COLS  = candleData.length;
    const cellW = W / COLS;
    const cellH = H / ROWS;

    const shortGrid:    number[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));
    const longGrid:     number[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));
    const colShortTotal = new Array(COLS).fill(0);
    const colLongTotal  = new Array(COLS).fill(0);
    const colVol        = candleData.map(c => parseFloat(c.v) * parseFloat(c.c)); // volume in USD

    const addToGrid = (
      grid: number[][], colTotals: number[],
      ci: number, price: number, notional: number,
    ) => {
      const baseRow = ROWS - 1 - Math.floor(((price - minP) / (maxP - minP)) * ROWS);
      const spread  = Math.max(1, Math.floor(ROWS * 0.025));
      for (let dr = -spread; dr <= spread; dr++) {
        const r = baseRow + dr;
        if (r < 0 || r >= ROWS) continue;
        const w = 1 - Math.abs(dr) / (spread + 1);
        grid[ci][r] += notional * w;
      }
      colTotals[ci] += notional;
    };

    // Build estimated liq zones from wick data
    for (let ci = 0; ci < candleData.length; ci++) {
      const c         = candleData[ci];
      const high      = parseFloat(c.h);
      const low       = parseFloat(c.l);
      const open      = parseFloat(c.o);
      const close     = parseFloat(c.c);
      const vol       = parseFloat(c.v);
      const closeUsd  = close;
      const body      = Math.abs(close - open);
      const bodyAvg   = body > 0 ? body : (high - low) * 0.1;
      const upperWick = high  - Math.max(open, close);
      const lowerWick = Math.min(open, close) - low;

      // Scale: volume × wick ratio → estimated liq notional
      const volUsd = vol * closeUsd;
      const scale  = volUsd * 0.0003;

      // Upper wick → short liq cluster (price swept above, shorts got squeezed)
      if (upperWick > bodyAvg * 0.1) {
        const intensity = Math.min(upperWick / (high - low + 0.0001), 1);
        // Spread heat across the wick range
        const wickSteps = Math.max(3, Math.floor(upperWick / (high - low + 0.0001) * 20));
        for (let s = 0; s <= wickSteps; s++) {
          const p = Math.max(open, close) + (s / wickSteps) * upperWick;
          const w = 1 - (s / (wickSteps + 1)) * 0.4; // taper toward tip
          addToGrid(shortGrid, colShortTotal, ci, p, scale * intensity * w);
        }
      }

      // Lower wick → long liq cluster (price swept below, longs got liquidated)
      if (lowerWick > bodyAvg * 0.1) {
        const intensity = Math.min(lowerWick / (high - low + 0.0001), 1);
        const wickSteps = Math.max(3, Math.floor(lowerWick / (high - low + 0.0001) * 20));
        for (let s = 0; s <= wickSteps; s++) {
          const p = Math.min(open, close) - (s / wickSteps) * lowerWick;
          const w = 1 - (s / (wickSteps + 1)) * 0.4;
          addToGrid(longGrid, colLongTotal, ci, p, scale * intensity * w);
        }
      }

      // Body rejection: strong body move also signals liq on the opposite side
      if (body > (high - low) * 0.5) {
        const isUp   = close > open;
        const rejPx  = isUp ? low  : high;
        const rejAmt = scale * 0.3;
        if (isUp)  addToGrid(longGrid,  colLongTotal,  ci, rejPx, rejAmt);
        else       addToGrid(shortGrid, colShortTotal, ci, rejPx, rejAmt);
      }
    }

    // Normalise
    let maxShort = 0, maxLong = 0;
    for (let ci = 0; ci < COLS; ci++) {
      for (let ri = 0; ri < ROWS; ri++) {
        if (shortGrid[ci][ri] > maxShort) maxShort = shortGrid[ci][ri];
        if (longGrid[ci][ri]  > maxLong ) maxLong  = longGrid[ci][ri];
      }
    }
    const normShort = (v: number) => maxShort > 0 ? Math.pow(v / maxShort, 0.42) : 0;
    const normLong  = (v: number) => maxLong  > 0 ? Math.pow(v / maxLong,  0.42) : 0;

    metaRef.current = { minP, maxP, minT, maxT, COLS, cellW, cellH, W, H,
      shortGrid, longGrid, colShortTotal, colLongTotal, colVol, candles: candleData };

    // ── Background ────────────────────────────────────────────────────────
    ctx.fillStyle = isDark ? '#060918' : '#f0f4f8';
    ctx.fillRect(0, 0, W, H);

    // ── Heatmap cells ─────────────────────────────────────────────────────
    for (let ci = 0; ci < COLS; ci++) {
      const closePx  = parseFloat(candleData[ci]?.c || '0');
      const priceRow = ROWS - 1 - Math.floor(((closePx - minP) / (maxP - minP)) * ROWS);

      for (let ri = 0; ri < ROWS; ri++) {
        const abovePrice = ri <= priceRow;
        let color = 'transparent';
        if ((side === 'all' || side === 'short') && abovePrice) {
          const v = normShort(shortGrid[ci][ri]);
          if (v > 0.03) color = shortColor(v);
        }
        if ((side === 'all' || side === 'long') && !abovePrice) {
          const v = normLong(longGrid[ci][ri]);
          if (v > 0.03) color = longColor(v);
        }
        if (color === 'transparent') continue;
        ctx.fillStyle = color;
        ctx.fillRect(Math.floor(ci * cellW), Math.floor(ri * cellH), Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
      }
    }

    // ── Subtle horizontal grid lines ──────────────────────────────────────
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = (i / 8) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ── Dollar labels for high-intensity columns ───────────────────────────
    ctx.font = 'bold 9px ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    const labelThreshold = Math.max(colShortTotal[0] || 0, colLongTotal[0] || 0) * 0.2;
    for (let ci = 0; ci < COLS; ci++) {
      const cx = (ci + 0.5) * cellW;
      if ((side === 'all' || side === 'short') && colShortTotal[ci] > labelThreshold && colShortTotal[ci] > 0) {
        let peakRow = 0, peakVal = 0;
        for (let ri = 0; ri < ROWS / 2; ri++) {
          if (shortGrid[ci][ri] > peakVal) { peakVal = shortGrid[ci][ri]; peakRow = ri; }
        }
        const y = Math.max(10, peakRow * cellH - 3);
        ctx.fillStyle = 'rgba(255,200,0,0.92)';
        ctx.fillText(fmtUSD(colShortTotal[ci]), cx, y);
      }
      if ((side === 'all' || side === 'long') && colLongTotal[ci] > labelThreshold && colLongTotal[ci] > 0) {
        let peakRow = ROWS - 1, peakVal = 0;
        for (let ri = Math.floor(ROWS / 2); ri < ROWS; ri++) {
          if (longGrid[ci][ri] > peakVal) { peakVal = longGrid[ci][ri]; peakRow = ri; }
        }
        const y = Math.min(H - 4, peakRow * cellH + 10);
        ctx.fillStyle = 'rgba(100,255,180,0.92)';
        ctx.fillText(fmtUSD(colLongTotal[ci]), cx, y);
      }
    }

    // ── Price line ────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle = '#ff3344';
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = 'rgba(255,40,60,0.5)';
    ctx.shadowBlur  = 4;
    for (let ci = 0; ci < candleData.length; ci++) {
      const price = parseFloat(candleData[ci].c);
      const x = (ci + 0.5) * cellW;
      const y = H - ((price - minP) / (maxP - minP)) * H;
      if (ci === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── Current price dashed line ─────────────────────────────────────────
    const lastPrice = parseFloat(candleData[candleData.length - 1]?.c || '0');
    if (lastPrice) {
      const y = H - ((lastPrice - minP) / (maxP - minP)) * H;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      // Price label on line
      const label = fmtPrice(lastPrice);
      const tw = ctx.measureText(label).width;
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = isDark ? 'rgba(6,9,24,0.85)' : 'rgba(240,244,248,0.9)';
      ctx.fillRect(W - tw - 14, y - 8, tw + 10, 15);
      ctx.fillStyle = '#ff3344';
      ctx.textAlign = 'right';
      ctx.fillText(label, W - 4, y + 4);
    }

    // ── Y-axis price labels ───────────────────────────────────────────────
    const lc  = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
    const lbg = isDark ? 'rgba(6,9,24,0.7)'       : 'rgba(240,244,248,0.85)';
    ctx.font      = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 7; i++) {
      const pct   = i / 7;
      const price = maxP - pct * (maxP - minP);
      const y     = pct * H;
      const label = fmtPrice(price);
      const tw    = ctx.measureText(label).width;
      ctx.fillStyle = lbg;
      ctx.fillRect(W - tw - 12, y - 7, tw + 9, 14);
      ctx.fillStyle = lc;
      ctx.fillText(label, W - 4, y + 4);
    }

    // ── Right legend ──────────────────────────────────────────────────────
    const lx    = W + 4;
    const lgH   = H / 2 - 28;
    ctx.font      = 'bold 9px ui-sans-serif, sans-serif';
    ctx.textAlign = 'left';

    // Short legend
    ctx.fillStyle = isDark ? 'rgba(255,100,100,0.9)' : 'rgba(200,0,0,0.8)';
    ctx.fillText('Short', lx, 14);
    const shortTiers = ['>$2M', '$750k–$2M', '$250k–$750k', '<$250k'];
    const shortVals  = [1, 0.65, 0.35, 0.12];
    for (let i = 0; i < 4; i++) {
      const y = 22 + i * (lgH / 4);
      ctx.fillStyle = shortColor(shortVals[i]);
      ctx.fillRect(lx, y, 11, lgH / 4 - 2);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillText(shortTiers[i], lx + 13, y + 8);
    }

    // Divider
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W, H / 2); ctx.lineTo(canvas.width, H / 2); ctx.stroke();

    // Long legend
    ctx.font      = 'bold 9px ui-sans-serif, sans-serif';
    ctx.fillStyle = isDark ? 'rgba(80,220,180,0.9)' : 'rgba(0,140,100,0.8)';
    ctx.fillText('Long', lx, H / 2 + 14);
    const longTiers = ['>$2M', '$750k–$2M', '$250k–$750k', '<$250k'];
    const longVals  = [1, 0.65, 0.35, 0.12];
    for (let i = 0; i < 4; i++) {
      const y = H / 2 + 22 + i * (lgH / 4);
      ctx.fillStyle = longColor(longVals[i]);
      ctx.fillRect(lx, y, 11, lgH / 4 - 2);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillText(longTiers[i], lx + 13, y + 8);
    }

    // ── Stats ─────────────────────────────────────────────────────────────
    const first  = parseFloat(candleData[0]?.c || '0');
    const last   = parseFloat(candleData[candleData.length - 1]?.c || '0');
    const change = first > 0 ? ((last - first) / first) * 100 : 0;
    const vol24h = candleData.reduce((s, c) => s + parseFloat(c.v) * parseFloat(c.c), 0);
    setStats({
      currentPrice: last,
      highPrice:    Math.max(...highs),
      lowPrice:     Math.min(...lows),
      change24h:    change,
      vol24h,
    });
    setLoading(false);
  }, [isDark]);

  // ── Draw volume sub-chart ─────────────────────────────────────────────────
  const drawVolume = useCallback((candleData: Candle[]) => {
    const canvas = volRef.current;
    if (!canvas || !candleData.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W    = canvas.width - LEGEND_W;
    const H    = canvas.height;
    const COLS = candleData.length;
    const cellW = W / COLS;

    ctx.clearRect(0, 0, canvas.width, H);
    ctx.fillStyle = isDark ? '#060918' : '#f0f4f8';
    ctx.fillRect(0, 0, W, H);

    const vols = candleData.map(c => parseFloat(c.v) * parseFloat(c.c));
    const maxV = Math.max(...vols, 1);

    for (let ci = 0; ci < COLS; ci++) {
      const c      = candleData[ci];
      const isUp   = parseFloat(c.c) >= parseFloat(c.o);
      const barH   = Math.max(1, (vols[ci] / maxV) * (H - 4));
      const x      = Math.floor(ci * cellW);
      const y      = H - barH;
      ctx.fillStyle = isUp
        ? 'rgba(52,211,153,0.55)'
        : 'rgba(248,113,113,0.55)';
      ctx.fillRect(x + 1, y, Math.max(1, Math.ceil(cellW) - 1), barH);
    }

    // Vol label
    ctx.font      = '8px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    ctx.fillText('VOL', 4, 10);
  }, [isDark]);

  // ── Fetch + render ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const range = TIME_RANGES[rangeIdx];
    const end   = Date.now();
    const start = end - range.hours * 3_600_000;

    fetch(
      `/api/proxy?path=${encodeURIComponent(
        `kline?symbol=${symbol}&interval=${range.interval}&start_time=${start}&end_time=${end}`
      )}`,
    )
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        const data: Candle[] = json.success && Array.isArray(json.data) ? json.data : [];
        if (!data.length) { setError('No candle data available'); setLoading(false); return; }
        setCandles(data);
        draw(data, sideMode);
        drawVolume(data);
      })
      .catch(() => {
        if (!cancelled) { setError('Failed to load data'); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [symbol, rangeIdx, sideMode, draw, drawVolume]);

  // Redraw on side change without refetch
  useEffect(() => {
    if (candles.length) { draw(candles, sideMode); }
  }, [sideMode, candles, draw]);

  // ── Crosshair + tooltip ────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left)  * (canvas.width  / rect.width);
    const my = (e.clientY - rect.top)   * (canvas.height / rect.height);
    const { minP, maxP, minT, maxT, COLS, cellW, cellH, W, H,
            shortGrid, longGrid, colShortTotal, colLongTotal, colVol, candles: cData } = metaRef.current;
    if (!COLS) return;

    const col = Math.min(Math.max(Math.floor(mx / cellW), 0), COLS - 1);
    const row = Math.min(Math.max(Math.floor(my / cellH), 0), ROWS - 1);
    const ts  = minT + (mx / W) * (maxT - minT);

    const candle     = cData[col];
    const closePrice = candle ? parseFloat(candle.c) : maxP - (my / H) * (maxP - minP);
    const abovePrice = my < H - ((closePrice - minP) / (maxP - minP)) * H;

    const liqVol   = abovePrice ? (colShortTotal[col] || 0) : (colLongTotal[col] || 0);
    const sideLabel = abovePrice ? 'Short Zone' : 'Long Zone';
    const volUsd    = colVol?.[col] || 0;

    const sv = shortGrid[col]?.[row] ?? 0;
    const lv = longGrid[col]?.[row]  ?? 0;
    const allMax = Math.max(
      ...shortGrid.map(col2 => Math.max(...col2)),
      ...longGrid.map(col2  => Math.max(...col2)),
      1,
    );
    const rawIntensity = Math.max(sv, lv);
    const intensity    = rawIntensity > 0 ? Math.pow(rawIntensity / allMax, 0.42) : 0;

    // Overlay crosshair
    const oc = overlayRef.current;
    if (oc) {
      const oc2 = oc.getContext('2d');
      if (oc2) {
        oc2.clearRect(0, 0, oc.width, oc.height);
        oc2.strokeStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
        oc2.setLineDash([4, 4]);
        oc2.lineWidth = 1;
        oc2.beginPath(); oc2.moveTo(mx, 0); oc2.lineTo(mx, H); oc2.stroke();
        oc2.beginPath(); oc2.moveTo(0, my); oc2.lineTo(W, my); oc2.stroke();
        oc2.setLineDash([]);
      }
    }

    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      date: new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).replace(',', ''),
      price:     fmtPrice(closePrice),
      liqVol,
      side:      sideLabel,
      intensity: intensity > 0.05 ? intensityLabel(intensity) : '',
      volUsd,
    });
  }, [isDark]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    const oc = overlayRef.current;
    if (oc) oc.getContext('2d')?.clearRect(0, 0, oc.width, oc.height);
  }, []);

  // ESC closes dropdown
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setDropOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Filtered markets for dropdown — sadece gerçek liq verisi olan semboller ──
  const filteredMarkets = markets.filter(m => {
    const sym = m.symbol.replace(/-USD$/i, '').toUpperCase();
    const hasData = liqLoading || supportedSymbols.size === 0 || supportedSymbols.has(sym);
    return hasData && m.symbol.toLowerCase().includes(searchQ.toLowerCase());
  });

  // ── Theme ─────────────────────────────────────────────────────────────────
  const bg     = isDark ? '#07091c' : '#ffffff';
  const bg2    = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
  const text1  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const text2  = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';

  const coin = symbol.replace(/-USD$/i, '');

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      {/* ── Top bar: coin selector + stats ── */}
      <div
        className="flex items-center gap-4 px-4 py-2.5 shrink-0"
        style={{ borderBottom: `1px solid ${border}`, background: bg2 }}
      >
        {/* Coin selector */}
        <div className="relative">
          <button
            onClick={() => setDropOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
            style={{
              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${border}`,
            }}
          >
            {symbol && <CoinLogo symbol={symbol} size={18} />}
            <span className="text-[13px] font-bold" style={{ color: text1 }}>
              {coin || 'Select'}
            </span>
            {hasLiveData && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                style={{ background: 'rgba(0,180,216,0.18)', color: '#00d4ff', border: '1px solid rgba(0,180,216,0.3)' }}>
                LIVE DATA
              </span>
            )}
            <span className="text-[10px]" style={{ color: text2 }}>▾</span>
          </button>

          {dropOpen && (
            <div
              className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
              style={{
                width: 200,
                background: isDark ? '#0d1030' : '#ffffff',
                border: `1px solid ${border}`,
                maxHeight: 320,
              }}
            >
              <div className="p-2 border-b" style={{ borderColor: border }}>
                <input
                  autoFocus
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search..."
                  className="w-full bg-transparent outline-none text-[12px] px-2 py-1"
                  style={{ color: text1 }}
                />
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
                {filteredMarkets.map(m => (
                  <button
                    key={m.symbol}
                    onClick={() => { setSymbol(m.symbol); setDropOpen(false); setSearchQ(''); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-white/5 transition-colors text-left"
                    style={{
                      background: m.symbol === symbol ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                    }}
                  >
                    <CoinLogo symbol={m.symbol} size={16} />
                    <span className="text-[12px] font-semibold" style={{ color: text1 }}>
                      {m.symbol.replace('-USD', '')}
                    </span>
                    {supportedSymbols.has(m.symbol.replace(/-USD$/i, '').toUpperCase()) && (
                      <span className="ml-auto text-[8px] font-bold px-1 py-0.5 rounded"
                        style={{ background: 'rgba(0,180,216,0.15)', color: '#00d4ff', whiteSpace: 'nowrap' }}>
                        LIVE
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Price + stats */}
        {stats.currentPrice > 0 && (
          <div className="flex items-center gap-4">
            <span className="font-mono text-[14px] font-bold" style={{ color: text1 }}>
              {fmtPrice(stats.currentPrice)}
            </span>
            <span
              className="text-[11px] font-semibold"
              style={{ color: stats.change24h >= 0 ? '#34d399' : '#f87171' }}
            >
              {stats.change24h >= 0 ? '+' : ''}{stats.change24h.toFixed(2)}%
            </span>
            <span className="text-[10px]" style={{ color: text2 }}>
              H: <span style={{ color: text1 }}>{fmtPrice(stats.highPrice)}</span>
            </span>
            <span className="text-[10px]" style={{ color: text2 }}>
              L: <span style={{ color: text1 }}>{fmtPrice(stats.lowPrice)}</span>
            </span>
            <span className="text-[10px]" style={{ color: text2 }}>
              Vol: <span style={{ color: text1 }}>{fmtUSD(stats.vol24h)}</span>
            </span>
          </div>
        )}

        {loading && (
          <div
            className="w-4 h-4 border-2 rounded-full animate-spin ml-auto"
            style={{ borderColor: 'rgba(255,255,255,0.1)', borderTopColor: '#00d4ff' }}
          />
        )}
      </div>

      {/* ── Controls: Range + Side ── */}
      <div
        className="flex items-center gap-5 px-4 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${border}`, background: bg2 }}
      >
        {/* Range */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium" style={{ color: text2 }}>Range</span>
          {TIME_RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIdx(i)}
              className="text-[10px] font-bold px-2.5 py-0.5 rounded-md transition-all"
              style={{
                background: rangeIdx === i
                  ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)')
                  : 'transparent',
                color: rangeIdx === i ? text1 : text2,
                border: `1px solid ${rangeIdx === i
                  ? (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)')
                  : 'transparent'}`,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Side */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium" style={{ color: text2 }}>Side</span>
          {(['all', 'long', 'short'] as SideMode[]).map(s => (
            <button
              key={s}
              onClick={() => setSideMode(s)}
              className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-md transition-all"
              style={{
                background: sideMode === s
                  ? s === 'long'  ? 'rgba(52,211,153,0.15)'
                  : s === 'short' ? 'rgba(248,113,113,0.15)'
                  : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)')
                  : 'transparent',
                color: sideMode === s
                  ? s === 'long'  ? '#34d399'
                  : s === 'short' ? '#f87171'
                  : text1
                  : text2,
                border: `1px solid ${sideMode === s
                  ? s === 'long'  ? 'rgba(52,211,153,0.3)'
                  : s === 'short' ? 'rgba(248,113,113,0.3)'
                  : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)')
                  : 'transparent'}`,
              }}
            >
              {s === 'long' ? '🟢' : s === 'short' ? '🔴' : '⚡'}
              {' '}{s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Estimated badge */}
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className="text-[9px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(251,191,36,0.12)',
              color: '#fbbf24',
              border: '1px solid rgba(251,191,36,0.25)',
            }}
          >
            ⚠ Estimated — based on wick & volume analysis
          </span>
          {/* Legend strip */}
          <span className="text-[9px] ml-2" style={{ color: text2 }}>Short:</span>
          {[0.1, 0.4, 0.7, 1.0].map((v, i) => (
            <div key={i} className="w-3.5 h-2 rounded-sm" style={{ background: shortColor(v) }} />
          ))}
          <span className="text-[9px] ml-1.5" style={{ color: text2 }}>Long:</span>
          {[0.1, 0.4, 0.7, 1.0].map((v, i) => (
            <div key={i} className="w-3.5 h-2 rounded-sm" style={{ background: longColor(v) }} />
          ))}
        </div>
      </div>

      {/* ── Main canvas ── */}
      <div className="relative" style={{ height: 400 }}>
        {loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-10"
            style={{ background: bg }}
          >
            <div
              className="w-7 h-7 border-2 rounded-full animate-spin mb-2"
              style={{ borderColor: 'rgba(255,255,255,0.07)', borderTopColor: '#00d4ff' }}
            />
            <span className="text-[11px]" style={{ color: text2 }}>
              Loading {coin} data...
            </span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[12px]" style={{ color: '#f87171' }}>{error}</span>
          </div>
        )}
        <canvas ref={canvasRef}  width={940} height={400} className="absolute inset-0 w-full h-full" />
        <canvas ref={overlayRef} width={940} height={400}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none rounded-xl px-3 py-2.5 text-[11px] z-20"
            style={{
              left:       Math.min(tooltip.x + 14, 700),
              top:        Math.max(tooltip.y - 10, 4),
              background: isDark ? 'rgba(4,8,28,0.96)' : 'rgba(255,255,255,0.97)',
              border:     `1px solid ${border}`,
              color:      text1,
              boxShadow:  '0 8px 30px rgba(0,0,0,0.45)',
              minWidth:   180,
            }}
          >
            <div className="font-semibold mb-1" style={{ color: text2 }}>{tooltip.date}</div>
            <div className="mb-0.5">
              Price: <span className="font-mono font-bold">{tooltip.price}</span>
            </div>
            {tooltip.liqVol > 0 && (
              <div>
                Est. Liq Zone: <span className="font-bold">{fmtUSD(tooltip.liqVol)}</span>
              </div>
            )}
            {tooltip.volUsd > 0 && (
              <div style={{ color: text2 }}>
                Candle Vol: <span style={{ color: text1 }}>{fmtUSD(tooltip.volUsd)}</span>
              </div>
            )}
            {tooltip.side && (
              <div style={{ color: tooltip.side.includes('Short') ? '#f87171' : '#34d399' }}>
                {tooltip.side}
              </div>
            )}
            {tooltip.intensity && (
              <div style={{ color: '#facc15' }}>Intensity: {tooltip.intensity}</div>
            )}
          </div>
        )}
      </div>

      {/* ── Volume sub-chart ── */}
      <div
        className="relative shrink-0"
        style={{ height: VOL_H, borderTop: `1px solid ${border}` }}
      >
        <canvas ref={volRef} width={940} height={VOL_H} className="absolute inset-0 w-full h-full" />
      </div>

      {/* ── X-axis time labels ── */}
      <div
        className="flex justify-between px-3 py-1.5 shrink-0"
        style={{ borderTop: `1px solid ${border}`, background: bg2 }}
      >
        {Array.from({ length: 8 }, (_, i) => {
          const { minT, maxT } = metaRef.current;
          const ts = minT && maxT ? minT + (i / 7) * (maxT - minT) : 0;
          return (
            <span key={i} className="text-[9px] font-mono" style={{ color: text2 }}>
              {ts
                ? new Date(ts).toLocaleString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  }).replace(',', '')
                : '—'}
            </span>
          );
        })}
      </div>
    </div>
  );
}
