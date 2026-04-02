'use client';
/**
 * LiquidationHeatmapModal — Coinglass-style liquidation heatmap
 * - X axis: time (48 × 1h candles)
 * - Y axis: price levels (horizontal bands)
 * - Color intensity: liquidation density at that price×time
 * - Price line overlay
 * - Supports light + dark theme via CSS var detection
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface Trade  { cause: string; side: string; price: string; amount: string; created_at: number; }

interface Props { symbol: string; onClose: () => void; }

// ── Color scale: purple → blue → cyan → green → yellow → white ────────────────
function heatRgb(v: number): string {
  if (v <= 0)    return 'rgba(30,10,60,0)';
  // stops: 0=dark purple, 0.2=indigo, 0.4=cyan, 0.65=lime, 0.85=yellow, 1=white
  type Stop = [number, number, number, number, number]; // t, r, g, b, a
  const stops: Stop[] = [
    [0,    20,  5,  50, 0.05],
    [0.08, 40, 20, 110, 0.2 ],
    [0.2,  0,  60, 180, 0.45],
    [0.38, 0, 180, 170, 0.62],
    [0.55, 0, 210,  80, 0.75],
    [0.72,180, 230,  0, 0.85],
    [0.88,255, 220,  0, 0.93],
    [1,   255, 255,200, 1   ],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i+1][0]) { lo = stops[i]; hi = stops[i+1]; break; }
  }
  const t = lo[0] === hi[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return `rgba(${Math.round(lerp(lo[1],hi[1]))},${Math.round(lerp(lo[2],hi[2]))},${Math.round(lerp(lo[3],hi[3]))},${(lerp(lo[4],hi[4])).toFixed(2)})`;
}

const TIME_RANGES = [
  { label: '12h', hours: 12, interval: '15m', intervalMs: 15*60*1000 },
  { label: '24h', hours: 24, interval: '1h',  intervalMs: 60*60*1000 },
  { label: '48h', hours: 48, interval: '1h',  intervalMs: 60*60*1000 },
  { label: '7d',  hours: 168,interval: '4h',  intervalMs: 4*60*60*1000 },
];

const ROWS = 80; // price buckets

function fmtPrice(p: number) {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1)     return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 0.01)  return p.toPrecision(4);
  return p.toExponential(3);
}
function fmtUSD(v: number) {
  return v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;
}

export default function LiquidationHeatmapModal({ symbol, onClose }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null); // for crosshair only
  const [rangeIdx, setRangeIdx] = useState(1); // default 24h
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');
  const [stats, setStats]       = useState({ currentPrice: 0, longLiq: 0, shortLiq: 0, candleCount: 0 });
  const [tooltip, setTooltip]   = useState<{ x: number; y: number; price: string; time: string; liq: string } | null>(null);
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Store rendered grid meta for tooltip/crosshair
  const metaRef = useRef({
    minP: 0, maxP: 0, minT: 0, maxT: 0, cols: 0,
    cellW: 0, cellH: 0, W: 0, H: 0,
    grid: [] as number[][], // [col][row] normalized 0-1
    candles: [] as Candle[],
  });

  const render = useCallback((candles: Candle[], trades: Trade[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!candles.length) { setLoading(false); return; }

    // Price range
    const highs = candles.map(c => parseFloat(c.h));
    const lows  = candles.map(c => parseFloat(c.l));
    let maxP = Math.max(...highs);
    let minP = Math.min(...lows);
    const pad = (maxP - minP) * 0.12;
    maxP += pad; minP -= pad;

    // Time range
    const times = candles.map(c => c.t > 1e12 ? c.t : c.t * 1000);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const COLS = candles.length;

    const cellW = W / COLS;
    const cellH = H / ROWS;

    // Build raw liq grid [col][row]
    const rawGrid: number[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));

    let longTotal = 0, shortTotal = 0;

    // 1. Real liquidation trades
    for (const t of trades) {
      const isLiq = t.cause === 'market_liquidation' || t.cause === 'backstop_liquidation'
        || (typeof t.cause === 'string' && t.cause.toLowerCase().includes('liq'));
      if (!isLiq) continue;
      const ts = t.created_at > 1e12 ? t.created_at : t.created_at * 1000;
      const price = parseFloat(t.price);
      const notional = price * parseFloat(t.amount);
      if (!notional || isNaN(notional)) continue;

      const col = Math.floor(((ts - minT) / (maxT - minT + 1)) * COLS);
      const row = ROWS - 1 - Math.floor(((price - minP) / (maxP - minP)) * ROWS);
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
        rawGrid[col][row] += notional;
      }
      if (t.side?.includes('long')) longTotal += notional; else shortTotal += notional;
    }

    // 2. Synthetic liq pressure from candle extremes (gives Coinglass-style bands)
    //    High = short liquidation cluster zone, Low = long liquidation cluster zone
    for (let ci = 0; ci < candles.length; ci++) {
      const c = candles[ci];
      const high  = parseFloat(c.h);
      const low   = parseFloat(c.l);
      const open  = parseFloat(c.o);
      const close = parseFloat(c.c);
      const vol   = parseFloat(c.v);
      const body  = Math.abs(close - open);

      // Distribute liq pressure across horizontal bands near key price levels
      // This creates the "banded" Coinglass look
      const addBand = (price: number, weight: number) => {
        const baseRow = ROWS - 1 - Math.floor(((price - minP) / (maxP - minP)) * ROWS);
        const spread = Math.max(1, Math.floor(ROWS * 0.025)); // ±2.5% price band
        for (let dr = -spread; dr <= spread; dr++) {
          const row = baseRow + dr;
          if (row < 0 || row >= ROWS) continue;
          const falloff = 1 - Math.abs(dr) / (spread + 1);
          rawGrid[ci][row] += vol * weight * falloff * 0.3;
        }
      };

      // High wick → short liq zone
      const upperWick = high - Math.max(open, close);
      if (upperWick > body * 0.2) addBand(high, upperWick / (maxP - minP));

      // Low wick → long liq zone
      const lowerWick = Math.min(open, close) - low;
      if (lowerWick > body * 0.2) addBand(low, lowerWick / (maxP - minP));

      // Round numbers → extra liq clusters (traders place stops there)
      const magnitude = Math.pow(10, Math.floor(Math.log10(close)));
      const nearestRound = Math.round(close / magnitude) * magnitude;
      if (Math.abs(nearestRound - close) / close < 0.03) {
        addBand(nearestRound, 0.5);
      }
    }

    // Normalize with gamma
    let maxVal = 0;
    for (let ci = 0; ci < COLS; ci++)
      for (let ri = 0; ri < ROWS; ri++)
        if (rawGrid[ci][ri] > maxVal) maxVal = rawGrid[ci][ri];

    const normGrid: number[][] = Array.from({ length: COLS }, (_, ci) =>
      rawGrid[ci].map(v => maxVal > 0 ? Math.pow(v / maxVal, 0.5) : 0)
    );

    metaRef.current = { minP, maxP, minT, maxT, cols: COLS, cellW, cellH, W, H, grid: normGrid, candles };

    // ── Draw background ────────────────────────────────────────────────
    ctx.fillStyle = isDark ? '#06091a' : '#f0f4f8';
    ctx.fillRect(0, 0, W, H);

    // ── Draw heatmap cells (horizontal band style) ─────────────────────
    for (let ri = 0; ri < ROWS; ri++) {
      for (let ci = 0; ci < COLS; ci++) {
        const v = normGrid[ci][ri];
        if (v < 0.04) continue;
        ctx.fillStyle = heatRgb(v);
        ctx.fillRect(
          Math.floor(ci * cellW), Math.floor(ri * cellH),
          Math.ceil(cellW) + 1,  Math.ceil(cellH) + 1
        );
      }
    }

    // ── Horizontal grid lines (subtle) ────────────────────────────────
    const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const y = (i / 8) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ── Price line ────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle = '#ff4455';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(255,50,70,0.5)';
    ctx.shadowBlur = 3;
    for (let ci = 0; ci < candles.length; ci++) {
      const price = parseFloat(candles[ci].c);
      const x = (ci + 0.5) * cellW;
      const y = H - ((price - minP) / (maxP - minP)) * H;
      if (ci === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── Price axis labels (right side) ────────────────────────────────
    const labelCount = 7;
    const labelColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= labelCount; i++) {
      const pct = i / labelCount;
      const price = maxP - pct * (maxP - minP);
      const y = pct * H;
      ctx.fillStyle = isDark ? 'rgba(20,30,60,0.7)' : 'rgba(240,244,248,0.8)';
      const label = '$' + fmtPrice(price);
      const tw = ctx.measureText(label).width;
      ctx.fillRect(W - tw - 10, y - 8, tw + 8, 14);
      ctx.fillStyle = labelColor;
      ctx.fillText(label, W - 4, y + 4);
    }

    // ── Current price dashed line ─────────────────────────────────────
    const lastPrice = parseFloat(candles[candles.length - 1]?.c || '0');
    if (lastPrice) {
      const y = H - ((lastPrice - minP) / (maxP - minP)) * H;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - 75, y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Color scale legend (left side) ────────────────────────────────
    const lgH = 100, lgW = 10, lgX = 6, lgY = H / 2 - lgH / 2;
    for (let i = 0; i < lgH; i++) {
      ctx.fillStyle = heatRgb(1 - i / lgH);
      ctx.fillRect(lgX, lgY + i, lgW, 1);
    }
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'left';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('High', lgX, lgY - 2);
    ctx.fillText('Low',  lgX, lgY + lgH + 10);

    setStats({ currentPrice: lastPrice, longLiq: longTotal, shortLiq: shortTotal, candleCount: candles.length });
    setLoading(false);
  }, [isDark]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const range = TIME_RANGES[rangeIdx];
    const end   = Date.now();
    const start = end - range.hours * 3600 * 1000;

    Promise.all([
      fetch(`/api/proxy?path=${encodeURIComponent(`kline?symbol=${symbol}&interval=${range.interval}&start_time=${start}&end_time=${end}`)}`).then(r => r.json()),
      fetch(`/api/proxy?path=${encodeURIComponent(`trades?symbol=${symbol}&limit=1000`)}`).then(r => r.json()),
    ]).then(([cj, tj]) => {
      if (cancelled) return;
      const candles: Candle[] = (cj.success && Array.isArray(cj.data)) ? cj.data : [];
      const trades: Trade[]   = (tj.success && Array.isArray(tj.data))  ? tj.data  : [];
      render(candles, trades);
    }).catch(() => {
      if (!cancelled) { setError('Failed to load data'); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [symbol, rangeIdx, render]);

  // Crosshair + tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const { minP, maxP, minT, maxT, cols, cellW, cellH, W, H, grid, candles } = metaRef.current;
    if (!cols) return;

    const price = maxP - (my / H) * (maxP - minP);
    const ts    = minT + (mx / W) * (maxT - minT);
    const col   = Math.floor(mx / cellW);
    const row   = Math.floor(my / cellH);
    const v     = (col >= 0 && col < cols && row >= 0 && row < ROWS) ? grid[col]?.[row] ?? 0 : 0;

    // Draw crosshair on overlay canvas
    const oc = overlayRef.current;
    if (oc) {
      const oc2 = oc.getContext('2d');
      if (oc2) {
        oc2.clearRect(0, 0, oc.width, oc.height);
        oc2.strokeStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
        oc2.setLineDash([4, 4]);
        oc2.lineWidth = 1;
        oc2.beginPath(); oc2.moveTo(mx, 0); oc2.lineTo(mx, H); oc2.stroke();
        oc2.beginPath(); oc2.moveTo(0, my); oc2.lineTo(W, my); oc2.stroke();
        oc2.setLineDash([]);
      }
    }

    const candle = candles[Math.min(col, candles.length - 1)];
    const closePrice = candle ? parseFloat(candle.c) : price;
    const date = new Date(ts);
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      price: '$' + fmtPrice(closePrice),
      time: date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
      liq: v > 0.05 ? `Density: ${(v * 100).toFixed(0)}%` : '',
    });
  }, [isDark]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    const oc = overlayRef.current;
    if (oc) oc.getContext('2d')?.clearRect(0, 0, oc.width, oc.height);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const bgModal  = isDark ? '#07091c' : '#ffffff';
  const bgHeader = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  const border   = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.1)';
  const text1    = isDark ? 'rgba(255,255,255,0.9)'  : 'rgba(0,0,0,0.85)';
  const text2    = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';

  const legendStops = [0, 0.2, 0.4, 0.65, 0.85, 1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: 900, maxWidth: '96vw', background: bgModal, border: `1px solid ${border}` }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3" style={{ background: bgHeader, borderBottom: `1px solid ${border}` }}>
          <div className="flex items-center gap-3">
            <CoinLogo symbol={symbol} size={22} />
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold" style={{ color: text1 }}>{symbol.replace('-USD', '')}</span>
              <span className="text-[11px]" style={{ color: text2 }}>Liquidation Heatmap · {TIME_RANGES[rangeIdx].label} · {TIME_RANGES[rangeIdx].interval} candles</span>
              {stats.currentPrice > 0 && (
                <span className="text-[13px] font-mono font-semibold" style={{ color: text1 }}>
                  ${fmtPrice(stats.currentPrice)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(stats.longLiq > 0 || stats.shortLiq > 0) && (
              <div className="flex gap-3 text-[11px]">
                <span style={{ color: '#f87171' }}>Long liq: <b>{fmtUSD(stats.longLiq)}</b></span>
                <span style={{ color: '#4ade80' }}>Short liq: <b>{fmtUSD(stats.shortLiq)}</b></span>
              </div>
            )}
            <button onClick={onClose} className="text-[18px] leading-none transition-opacity hover:opacity-60" style={{ color: text2 }}>✕</button>
          </div>
        </div>

        {/* ── Time range filter ── */}
        <div className="flex items-center gap-2 px-5 py-2" style={{ borderBottom: `1px solid ${border}` }}>
          <span className="text-[10px] mr-1" style={{ color: text2 }}>Range:</span>
          {TIME_RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIdx(i)}
              className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition-all"
              style={{
                background: rangeIdx === i ? (isDark ? 'rgba(0,180,220,0.18)' : 'rgba(0,150,200,0.12)') : 'transparent',
                color: rangeIdx === i ? (isDark ? '#00d4ff' : '#0077aa') : text2,
                border: rangeIdx === i ? `1px solid ${isDark ? 'rgba(0,180,220,0.4)' : 'rgba(0,150,200,0.3)'}` : `1px solid transparent`,
              }}
            >
              {r.label}
            </button>
          ))}

          {/* Color legend */}
          <div className="flex items-center gap-1.5 ml-4">
            <span className="text-[10px]" style={{ color: text2 }}>Intensity:</span>
            <div className="flex gap-0.5">
              {legendStops.map((v, i) => (
                <div key={i} className="w-5 h-3 rounded-sm" style={{ background: heatRgb(v) }} />
              ))}
            </div>
            <span className="text-[10px]" style={{ color: text2 }}>Low → High</span>
            <span className="text-[10px] ml-3" style={{ color: text2 }}>
              — <span style={{ color: '#ff4455' }}>Price</span>
            </span>
          </div>
        </div>

        {/* ── Canvas area ── */}
        <div className="relative" style={{ height: 420 }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: bgModal }}>
              <div className="w-8 h-8 border-2 border-t-cyan-400 rounded-full animate-spin mb-3" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderTopColor: '#00d4ff' }} />
              <span className="text-[12px]" style={{ color: text2 }}>Loading {symbol} data...</span>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[12px] text-red-400">{error}</span>
            </div>
          )}

          {/* Main heatmap canvas */}
          <canvas ref={canvasRef} width={900} height={420} className="absolute inset-0 w-full h-full" />
          {/* Crosshair overlay canvas */}
          <canvas
            ref={overlayRef}
            width={900}
            height={420}
            className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />

          {/* Tooltip */}
          {tooltip && (
            <div
              className="absolute pointer-events-none rounded-lg px-3 py-2 text-[11px]"
              style={{
                left:  Math.min(tooltip.x + 12, 720),
                top:   Math.max(tooltip.y - 16, 4),
                background: isDark ? 'rgba(5,10,30,0.92)' : 'rgba(255,255,255,0.95)',
                border: `1px solid ${border}`,
                color: text1,
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                minWidth: 140,
              }}
            >
              <div className="font-semibold mb-0.5">{tooltip.time}</div>
              <div className="font-mono">Price: {tooltip.price}</div>
              {tooltip.liq && <div style={{ color: '#facc15' }}>{tooltip.liq}</div>}
            </div>
          )}
        </div>

        {/* ── X-axis time labels ── */}
        <div
          className="flex justify-between px-4 py-1.5"
          style={{ borderTop: `1px solid ${border}`, background: bgHeader }}
        >
          {Array.from({ length: 7 }, (_, i) => {
            const { minT, maxT } = metaRef.current;
            const ts = minT && maxT ? minT + (i / 6) * (maxT - minT) : 0;
            return (
              <span key={i} className="text-[9px] font-mono" style={{ color: text2 }}>
                {ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
