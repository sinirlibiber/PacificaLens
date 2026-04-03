'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Market } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';

interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface HeatmapViewProps { markets: Market[]; defaultSymbol?: string; }

const RANGES = [
  { label: '12h', hours: 12,  interval: '15m' },
  { label: '24h', hours: 24,  interval: '1h'  },
  { label: '48h', hours: 48,  interval: '1h'  },
  { label: '7d',  hours: 168, interval: '4h'  },
];
type Side = 'all' | 'long' | 'short';
const ROWS    = 100;
const RIGHT_W = 56;
const VOL_H   = 48;

// ── Color scales ──────────────────────────────────────────────────────────────
function shortColor(v: number): string {
  if (v <= 0.02) return 'transparent';
  const stops: [number, number, number, number, number][] = [
    [0,    50,  0,   0, 0.0],
    [0.15, 130, 10,  0, 0.4],
    [0.40, 210, 60,  0, 0.6],
    [0.65, 245, 140, 0, 0.8],
    [0.85, 255, 210, 0, 0.9],
    [1,    255, 255, 180, 1 ],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = lo[0] === hi[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const l = (a: number, b: number) => a + (b - a) * t;
  return `rgba(${Math.round(l(lo[1],hi[1]))},${Math.round(l(lo[2],hi[2]))},${Math.round(l(lo[3],hi[3]))},${l(lo[4],hi[4]).toFixed(2)})`;
}

function longColor(v: number): string {
  if (v <= 0.02) return 'transparent';
  const stops: [number, number, number, number, number][] = [
    [0,    0,  20,  45, 0.0],
    [0.15, 0,  75, 105, 0.4],
    [0.40, 0,  170,160, 0.6],
    [0.65, 0,  210, 90, 0.8],
    [0.85, 70, 230, 40, 0.9],
    [1,    200,255, 100, 1  ],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = lo[0] === hi[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const l = (a: number, b: number) => a + (b - a) * t;
  return `rgba(${Math.round(l(lo[1],hi[1]))},${Math.round(l(lo[2],hi[2]))},${Math.round(l(lo[3],hi[3]))},${l(lo[4],hi[4]).toFixed(2)})`;
}

function fmtP(p: number) {
  if (p >= 10000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1)     return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.001) return '$' + p.toPrecision(4);
  return '$' + p.toExponential(2);
}
function fmtV(v: number) {
  return v >= 1e9 ? `$${(v/1e9).toFixed(2)}B`
       : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M`
       : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K`
       : `$${v.toFixed(0)}`;
}
function intensityLabel(v: number) {
  if (v > 0.85) return 'Extreme';
  if (v > 0.65) return 'Very High';
  if (v > 0.40) return 'High';
  if (v > 0.20) return 'Medium';
  return 'Low';
}

export default function HeatmapView({ markets, defaultSymbol }: HeatmapViewProps) {
  const heatRef  = useRef<HTMLCanvasElement>(null);
  const volRef   = useRef<HTMLCanvasElement>(null);
  const crossRef = useRef<HTMLCanvasElement>(null);

  const [symbol,   setSymbol  ] = useState(defaultSymbol ?? '');
  const [rangeIdx, setRangeIdx] = useState(1);
  const [side,     setSide    ] = useState<Side>('all');
  const [loading,  setLoading ] = useState(false);
  const [error,    setError   ] = useState('');
  const [search,   setSearch  ] = useState('');
  const [dropOpen, setDropOpen] = useState(false);
  const [stats,    setStats   ] = useState({ price: 0, change: 0, high: 0, low: 0, vol: 0 });
  const [tooltip,  setTooltip ] = useState<{
    x: number; y: number; date: string; price: string;
    side: string; intensity: string; vol: string;
  } | null>(null);

  const meta = useRef({
    minP: 0, maxP: 0, minT: 0, maxT: 0,
    COLS: 0, cellW: 0, cellH: 0, W: 0, H: 0,
    shortGrid: [] as number[][], longGrid: [] as number[][],
    vols: [] as number[], candles: [] as Candle[],
  });

  useEffect(() => {
    if (!symbol && markets.length) setSymbol(markets[0].symbol);
  }, [markets, symbol]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setDropOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Draw heatmap ────────────────────────────────────────────────────────────
  const drawHeat = useCallback((candles: Candle[], activeSide: Side) => {
    const canvas = heatRef.current;
    if (!canvas || !candles.length) { setLoading(false); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width - RIGHT_W;
    const H = canvas.height;

    const highs = candles.map(c => +c.h);
    const lows  = candles.map(c => +c.l);
    let maxP = Math.max(...highs);
    let minP = Math.min(...lows);
    const pad = (maxP - minP) * 0.1;
    maxP += pad; minP -= pad;

    const times = candles.map(c => c.t > 1e12 ? c.t : c.t * 1000);
    const minT  = Math.min(...times);
    const maxT  = Math.max(...times);
    const COLS  = candles.length;
    const cellW = W / COLS;
    const cellH = H / ROWS;

    const shortGrid: number[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));
    const longGrid:  number[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));
    const vols: number[] = [];

    const addZone = (grid: number[][], ci: number, priceLow: number, priceHigh: number, weight: number) => {
      const r0 = ROWS - 1 - Math.floor(((priceHigh - minP) / (maxP - minP)) * ROWS);
      const r1 = ROWS - 1 - Math.floor(((priceLow  - minP) / (maxP - minP)) * ROWS);
      const center = (r0 + r1) / 2;
      const spread = Math.max(1, (r1 - r0) / 2);
      for (let r = Math.max(0, r0 - 2); r <= Math.min(ROWS - 1, r1 + 2); r++) {
        const g = Math.exp(-0.5 * Math.pow((r - center) / spread, 2));
        grid[ci][r] += weight * g;
      }
    };

    for (let ci = 0; ci < COLS; ci++) {
      const c   = candles[ci];
      const high = +c.h, low = +c.l, open = +c.o, close = +c.c, vol = +c.v;
      const body      = Math.abs(close - open);
      const range     = high - low || 0.0001;
      const volUsd    = vol * close;
      const scale     = volUsd * 0.0004;
      const upperWick = high - Math.max(open, close);
      const lowerWick = Math.min(open, close) - low;

      vols.push(volUsd);

      if (upperWick > range * 0.05) {
        addZone(shortGrid, ci, Math.max(open, close), high, (upperWick / range) * scale);
      }
      if (lowerWick > range * 0.05) {
        addZone(longGrid, ci, low, Math.min(open, close), (lowerWick / range) * scale);
      }
      if (body > range * 0.45) {
        const w = (body / range) * scale * 0.25;
        if (close > open) addZone(longGrid,  ci, low,  low  + range * 0.15, w);
        else              addZone(shortGrid, ci, high - range * 0.15, high, w);
      }
    }

    let maxS = 0, maxL = 0;
    for (let ci = 0; ci < COLS; ci++) {
      for (let ri = 0; ri < ROWS; ri++) {
        if (shortGrid[ci][ri] > maxS) maxS = shortGrid[ci][ri];
        if (longGrid[ci][ri]  > maxL) maxL = longGrid[ci][ri];
      }
    }
    const ns = (v: number) => maxS > 0 ? Math.pow(v / maxS, 0.38) : 0;
    const nl = (v: number) => maxL > 0 ? Math.pow(v / maxL, 0.38) : 0;

    meta.current = { minP, maxP, minT, maxT, COLS, cellW, cellH, W, H,
                     shortGrid, longGrid, vols, candles };

    ctx.fillStyle = '#060918';
    ctx.fillRect(0, 0, canvas.width, H);

    for (let ci = 0; ci < COLS; ci++) {
      const closeRow = ROWS - 1 - Math.floor(((+candles[ci].c - minP) / (maxP - minP)) * ROWS);
      for (let ri = 0; ri < ROWS; ri++) {
        let color = '';
        if ((activeSide === 'all' || activeSide === 'short') && ri <= closeRow) {
          const v = ns(shortGrid[ci][ri]);
          if (v > 0.02) color = shortColor(v);
        }
        if ((activeSide === 'all' || activeSide === 'long') && ri > closeRow) {
          const v = nl(longGrid[ci][ri]);
          if (v > 0.02) color = longColor(v);
        }
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(
          Math.floor(ci * cellW), Math.floor(ri * cellH),
          Math.ceil(cellW) + 1,  Math.ceil(cellH) + 1,
        );
      }
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const y = (i / 6) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Price line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,60,80,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = 'rgba(255,40,60,0.4)';
    ctx.shadowBlur  = 5;
    for (let ci = 0; ci < COLS; ci++) {
      const x = (ci + 0.5) * cellW;
      const y = H - ((+candles[ci].c - minP) / (maxP - minP)) * H;
      ci === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Current price dashed line
    const lastPx = +candles[candles.length - 1].c;
    const lastY  = H - ((lastPx - minP) / (maxP - minP)) * H;
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(W, lastY); ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis right panel
    ctx.fillStyle = '#060918';
    ctx.fillRect(W, 0, RIGHT_W, H);

    ctx.font      = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 6; i++) {
      const pct   = i / 6;
      const price = maxP - pct * (maxP - minP);
      const y     = pct * H;
      ctx.fillStyle = Math.abs(y - lastY) < 12 ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,0.3)';
      ctx.fillText(fmtP(price), W + RIGHT_W - 4, y + 4);
    }

    // Current price label
    ctx.fillStyle = 'rgba(255,40,60,0.18)';
    ctx.fillRect(W + 2, lastY - 9, RIGHT_W - 4, 17);
    ctx.fillStyle = '#ff4055';
    ctx.fillText(fmtP(lastPx), W + RIGHT_W - 4, lastY + 4);

    // Stats
    const first  = +candles[0].c;
    const last   = +candles[candles.length - 1].c;
    setStats({
      price:  last,
      change: first > 0 ? ((last - first) / first) * 100 : 0,
      high:   Math.max(...highs),
      low:    Math.min(...lows),
      vol:    vols.reduce((s, v2) => s + v2, 0),
    });
    setLoading(false);
  }, []);

  // ── Draw volume ─────────────────────────────────────────────────────────────
  const drawVol = useCallback((candles: Candle[]) => {
    const canvas = volRef.current;
    if (!canvas || !candles.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W     = canvas.width - RIGHT_W;
    const H     = canvas.height;
    const COLS  = candles.length;
    const cellW = W / COLS;
    const vols  = candles.map(c => +c.v * +c.c);
    const maxV  = Math.max(...vols, 1);

    ctx.fillStyle = '#060918';
    ctx.fillRect(0, 0, canvas.width, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.stroke();

    for (let ci = 0; ci < COLS; ci++) {
      const isUp = +candles[ci].c >= +candles[ci].o;
      const barH = Math.max(2, (vols[ci] / maxV) * (H - 4));
      ctx.fillStyle = isUp ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)';
      ctx.fillRect(Math.floor(ci * cellW) + 1, H - barH, Math.max(1, Math.ceil(cellW) - 2), barH);
    }

    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText('VOL', 6, 11);

    ctx.fillStyle = '#060918';
    ctx.fillRect(W, 0, RIGHT_W, H);
  }, []);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setTooltip(null);

    const r     = RANGES[rangeIdx];
    const end   = Date.now();
    const start = end - r.hours * 3_600_000;

    fetch(`/api/proxy?path=${encodeURIComponent(
      `kline?symbol=${symbol}&interval=${r.interval}&start_time=${start}&end_time=${end}`
    )}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        const data: Candle[] = json.success && Array.isArray(json.data) ? json.data : [];
        if (!data.length) { setError('No data available'); setLoading(false); return; }
        drawHeat(data, side);
        drawVol(data);
      })
      .catch(() => { if (!cancelled) { setError('Failed to load'); setLoading(false); } });

    return () => { cancelled = true; };
  }, [symbol, rangeIdx, side, drawHeat, drawVol]);

  // ── Mouse ───────────────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = crossRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const { minP, maxP, minT, maxT, COLS, cellW, cellH, W, H,
            shortGrid, longGrid, vols, candles } = meta.current;
    if (!COLS) return;

    const col = Math.min(Math.max(Math.floor(mx / cellW), 0), COLS - 1);
    const row = Math.min(Math.max(Math.floor(my / cellH), 0), ROWS - 1);
    const ts  = minT + (mx / W) * (maxT - minT);
    const priceAtMouse = maxP - (my / H) * (maxP - minP);
    const closePrice   = candles[col] ? +candles[col].c : priceAtMouse;
    const isAbove      = priceAtMouse >= closePrice;

    const sv  = shortGrid[col]?.[row] ?? 0;
    const lv  = longGrid[col]?.[row]  ?? 0;
    let allMax = 1;
    for (let ci = 0; ci < shortGrid.length; ci++) {
      for (let ri = 0; ri < ROWS; ri++) {
        if (shortGrid[ci][ri] > allMax) allMax = shortGrid[ci][ri];
        if (longGrid[ci][ri]  > allMax) allMax = longGrid[ci][ri];
      }
    }
    const raw       = Math.max(sv, lv);
    const intensity = raw > 0 ? Math.pow(raw / allMax, 0.38) : 0;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(W, my); ctx.stroke();
      ctx.setLineDash([]);

      // Price label on crosshair Y
      const plabel = fmtP(priceAtMouse);
      ctx.font = '10px ui-monospace, monospace';
      const tw = ctx.measureText(plabel).width;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(W - tw - 10, my - 9, tw + 8, 17);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.textAlign = 'right';
      ctx.fillText(plabel, W - 4, my + 4);
    }

    setTooltip({
      x:         e.clientX - rect.left,
      y:         e.clientY - rect.top,
      date:      new Date(ts).toLocaleString('en-US', {
                   month: 'short', day: 'numeric',
                   hour: '2-digit', minute: '2-digit', hour12: false,
                 }).replace(',', ''),
      price:     fmtP(priceAtMouse),
      side:      isAbove ? 'Short Zone' : 'Long Zone',
      intensity: intensity > 0.05 ? intensityLabel(intensity) : '',
      vol:       vols[col] ? fmtV(vols[col]) : '',
    });
  }, []);

  const onMouseLeave = useCallback(() => {
    setTooltip(null);
    const ctx = crossRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, crossRef.current!.width, crossRef.current!.height);
  }, []);

  // X-axis labels
  const xLabels = () => {
    const { minT, maxT } = meta.current;
    if (!minT || !maxT) return Array(6).fill('—');
    return Array.from({ length: 6 }, (_, i) => {
      const ts = minT + (i / 5) * (maxT - minT);
      return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).replace(',', '');
    });
  };

  const border = 'rgba(255,255,255,0.07)';
  const text1  = 'rgba(255,255,255,0.85)';
  const text2  = 'rgba(255,255,255,0.38)';
  const coin   = symbol.replace(/-USD$/i, '');
  const filteredMarkets = markets.filter(m =>
    m.symbol.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col rounded-xl overflow-hidden"
      style={{ background: '#060918', border: `1px solid ${border}` }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0"
        style={{ borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.02)' }}>

        {/* Coin selector */}
        <div className="relative">
          <button onClick={() => setDropOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-opacity hover:opacity-75"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${border}` }}>
            {symbol && <CoinLogo symbol={symbol} size={16} />}
            <span className="text-[13px] font-bold" style={{ color: text1 }}>{coin || 'Select'}</span>
            <span className="text-[10px]" style={{ color: text2 }}>▾</span>
          </button>

          {dropOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
              style={{ width: 180, background: '#0d1030', border: `1px solid ${border}`, maxHeight: 300 }}>
              <div className="p-2" style={{ borderBottom: `1px solid ${border}` }}>
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search..." className="w-full bg-transparent outline-none text-[12px] px-2 py-0.5"
                  style={{ color: text1 }} />
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
                {filteredMarkets.map(m => (
                  <button key={m.symbol}
                    onClick={() => { setSymbol(m.symbol); setDropOpen(false); setSearch(''); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors hover:bg-white/5"
                    style={{ background: m.symbol === symbol ? 'rgba(255,255,255,0.07)' : 'transparent' }}>
                    <CoinLogo symbol={m.symbol} size={14} />
                    <span className="text-[12px] font-medium" style={{ color: text1 }}>
                      {m.symbol.replace('-USD', '')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        {stats.price > 0 && (
          <div className="flex items-center gap-3">
            <span className="font-mono text-[14px] font-bold" style={{ color: text1 }}>
              {fmtP(stats.price)}
            </span>
            <span className="text-[11px] font-semibold"
              style={{ color: stats.change >= 0 ? '#34d399' : '#f87171' }}>
              {stats.change >= 0 ? '+' : ''}{stats.change.toFixed(2)}%
            </span>
            <span className="text-[10px]" style={{ color: text2 }}>
              H <span style={{ color: text1 }}>{fmtP(stats.high)}</span>
            </span>
            <span className="text-[10px]" style={{ color: text2 }}>
              L <span style={{ color: text1 }}>{fmtP(stats.low)}</span>
            </span>
            <span className="text-[10px]" style={{ color: text2 }}>
              Vol <span style={{ color: text1 }}>{fmtV(stats.vol)}</span>
            </span>
          </div>
        )}

        {loading && (
          <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin ml-auto"
            style={{ borderColor: 'rgba(255,255,255,0.08)', borderTopColor: '#00b4d8' }} />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 px-4 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.015)' }}>
        <div className="flex items-center gap-1">
          <span className="text-[10px] mr-1" style={{ color: text2 }}>Range</span>
          {RANGES.map((r, i) => (
            <button key={r.label} onClick={() => setRangeIdx(i)}
              className="text-[10px] font-semibold px-2.5 py-0.5 rounded-md transition-all"
              style={{
                background: rangeIdx === i ? 'rgba(0,180,216,0.15)' : 'transparent',
                color:      rangeIdx === i ? '#00d4ff' : text2,
                border:     `1px solid ${rangeIdx === i ? 'rgba(0,180,216,0.3)' : 'transparent'}`,
              }}>
              {r.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 14, background: border }} />

        <div className="flex items-center gap-1">
          <span className="text-[10px] mr-1" style={{ color: text2 }}>Side</span>
          {(['all', 'long', 'short'] as Side[]).map(s => (
            <button key={s} onClick={() => setSide(s)}
              className="text-[10px] font-semibold px-2.5 py-0.5 rounded-md transition-all"
              style={{
                background: side === s
                  ? s === 'long'  ? 'rgba(52,211,153,0.15)'
                  : s === 'short' ? 'rgba(248,113,113,0.15)'
                  : 'rgba(255,255,255,0.08)' : 'transparent',
                color: side === s
                  ? s === 'long' ? '#34d399' : s === 'short' ? '#f87171' : text1
                  : text2,
                border: `1px solid ${side === s
                  ? s === 'long' ? 'rgba(52,211,153,0.3)' : s === 'short' ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.15)'
                  : 'transparent'}`,
              }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-[9px]" style={{ color: '#f87171' }}>Short</span>
            {[0.15, 0.45, 0.75, 1].map((v, i) => (
              <div key={i} className="w-3 h-2 rounded-sm" style={{ background: shortColor(v) }} />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px]" style={{ color: '#34d399' }}>Long</span>
            {[0.15, 0.45, 0.75, 1].map((v, i) => (
              <div key={i} className="w-3 h-2 rounded-sm" style={{ background: longColor(v) }} />
            ))}
          </div>
          <span className="text-[8px] px-1.5 py-0.5 rounded-full ml-1"
            style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>
            wick-based estimate
          </span>
        </div>
      </div>

      {/* Heatmap */}
      <div className="relative" style={{ height: 380 }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center"
            style={{ background: '#060918' }}>
            <div className="w-6 h-6 border-2 rounded-full animate-spin mb-2"
              style={{ borderColor: 'rgba(255,255,255,0.06)', borderTopColor: '#00b4d8' }} />
            <span className="text-[11px]" style={{ color: text2 }}>Loading {coin}...</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[12px]" style={{ color: '#f87171' }}>{error}</span>
          </div>
        )}
        <canvas ref={heatRef}  width={940} height={380} className="absolute inset-0 w-full h-full" />
        <canvas ref={crossRef} width={940} height={380}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} />

        {tooltip && (
          <div className="absolute pointer-events-none z-20 rounded-xl px-3 py-2 text-[11px]"
            style={{
              left:       Math.min(tooltip.x + 16, 680),
              top:        Math.max(tooltip.y - 8, 4),
              background: 'rgba(4,6,22,0.95)',
              border:     `1px solid ${border}`,
              color:      text1,
              boxShadow:  '0 8px 24px rgba(0,0,0,0.5)',
              minWidth:   155,
            }}>
            <div className="text-[9px] mb-1.5 font-mono" style={{ color: text2 }}>{tooltip.date}</div>
            <div className="font-mono font-bold mb-0.5">{tooltip.price}</div>
            <div className="text-[10px]"
              style={{ color: tooltip.side === 'Short Zone' ? '#f87171' : '#34d399' }}>
              {tooltip.side}
              {tooltip.intensity && (
                <span className="ml-1.5" style={{ color: '#facc15' }}>· {tooltip.intensity}</span>
              )}
            </div>
            {tooltip.vol && (
              <div className="mt-1 text-[10px]" style={{ color: text2 }}>
                Candle vol <span style={{ color: text1 }}>{tooltip.vol}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Volume */}
      <div className="relative shrink-0" style={{ height: VOL_H }}>
        <canvas ref={volRef} width={940} height={VOL_H} className="absolute inset-0 w-full h-full" />
      </div>

      {/* X-axis */}
      <div className="flex justify-between px-3 py-1.5 shrink-0"
        style={{ borderTop: `1px solid ${border}`, background: 'rgba(255,255,255,0.015)' }}>
        {xLabels().map((label, i) => (
          <span key={i} className="text-[9px] font-mono" style={{ color: text2 }}>{label}</span>
        ))}
      </div>
    </div>
  );
}
