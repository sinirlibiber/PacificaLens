'use client';
/**
 * LiquidationHeatmapModal
 * Coinglass-style price × time liquidation heatmap.
 * - Fetches 1h candles (last 48h) + recent trades for a symbol
 * - Draws a canvas heatmap: X = time, Y = price, color = liq intensity
 * - Price line overlay on top
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle {
  t: number; o: string; h: string; l: string; c: string; v: string;
}
interface Trade {
  cause: string; side: string; price: string; amount: string; created_at: number;
}

interface Props {
  symbol: string;
  onClose: () => void;
}

const COLS = 48;   // 48 candles = 48h with 1h interval
const ROWS = 60;   // price buckets

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function heatColor(v: number): [number, number, number, number] {
  // 0 → deep purple, 0.3 → blue, 0.6 → cyan/green, 0.85 → yellow, 1 → white-hot
  if (v <= 0) return [20, 10, 40, 0.06];
  if (v < 0.15) return [lerp(20,30,v/0.15), lerp(10,0,v/0.15), lerp(40,80,v/0.15), lerp(0.06,0.25,v/0.15)];
  if (v < 0.4)  { const t=(v-0.15)/0.25; return [lerp(30,0,t), lerp(0,200,t), lerp(80,160,t), lerp(0.25,0.55,t)]; }
  if (v < 0.7)  { const t=(v-0.4)/0.3;  return [lerp(0,180,t), lerp(200,230,t), lerp(160,50,t), lerp(0.55,0.75,t)]; }
  if (v < 0.9)  { const t=(v-0.7)/0.2;  return [lerp(180,255,t), lerp(230,240,t), lerp(50,0,t), lerp(0.75,0.9,t)]; }
  const t=(v-0.9)/0.1; return [255, lerp(240,255,t), lerp(0,255,t), lerp(0.9,1,t)];
}

export default function LiquidationHeatmapModal({ symbol, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [currentPrice, setCurrentPrice] = useState(0);
  const [priceRange, setPriceRange]     = useState({ min: 0, max: 0 });
  const [liqTotal, setLiqTotal]         = useState({ long: 0, short: 0 });
  const [tooltip, setTooltip]           = useState<{ x: number; y: number; label: string } | null>(null);

  // price/time meta for tooltip
  const metaRef = useRef<{ minPrice: number; maxPrice: number; minTime: number; maxTime: number; cols: number; rows: number }>({
    minPrice: 0, maxPrice: 0, minTime: 0, maxTime: 0, cols: COLS, rows: ROWS,
  });

  const draw = useCallback((candles: Candle[], trades: Trade[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!candles.length) return;

    // Price range from candles
    const prices = candles.flatMap(c => [parseFloat(c.h), parseFloat(c.l)]);
    let minP = Math.min(...prices);
    let maxP = Math.max(...prices);
    const pad = (maxP - minP) * 0.08;
    minP -= pad; maxP += pad;

    // Time range
    const times = candles.map(c => c.t > 1e12 ? c.t : c.t * 1000);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);

    metaRef.current = { minPrice: minP, maxPrice: maxP, minTime: minT, maxTime: maxT, cols: COLS, rows: ROWS };
    setPriceRange({ min: minP, max: maxP });

    const cellW = W / COLS;
    const cellH = H / ROWS;

    // Build grid: [col][row] = liq USD
    const grid: number[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));

    let totalLong = 0, totalShort = 0;

    for (const t of trades) {
      const isLiq = t.cause === 'market_liquidation' || t.cause === 'backstop_liquidation'
        || (typeof t.cause === 'string' && t.cause.toLowerCase().includes('liq'));
      if (!isLiq) continue;

      const ts = t.created_at > 1e12 ? t.created_at : t.created_at * 1000;
      const price = parseFloat(t.price);
      const notional = price * parseFloat(t.amount);
      if (!notional || isNaN(notional) || price < minP || price > maxP) continue;
      if (ts < minT || ts > maxT + 3600000) continue;

      const col = Math.floor(((ts - minT) / (maxT - minT + 1)) * COLS);
      const row = ROWS - 1 - Math.floor(((price - minP) / (maxP - minP)) * ROWS);

      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
        grid[col][row] += notional;
      }

      if (t.side?.includes('long')) totalLong += notional;
      else totalShort += notional;
    }

    // Also add orderbook-style "virtual" liq clusters from candle wicks
    // High wicks = potential short liq zones, low wicks = potential long liq zones
    for (let ci = 0; ci < candles.length; ci++) {
      const c = candles[ci];
      const col = Math.min(ci, COLS - 1);
      const open = parseFloat(c.o), close = parseFloat(c.c);
      const high = parseFloat(c.h), low = parseFloat(c.l);
      const vol = parseFloat(c.v);
      const body = Math.abs(close - open);
      const upperWick = high - Math.max(open, close);
      const lowerWick = Math.min(open, close) - low;

      // Upper wick → short liq pressure
      if (upperWick > body * 0.3) {
        const wickPrice = high - upperWick * 0.3;
        const row = ROWS - 1 - Math.floor(((wickPrice - minP) / (maxP - minP)) * ROWS);
        if (row >= 0 && row < ROWS) grid[col][row] += vol * 0.001 * upperWick;
      }
      // Lower wick → long liq pressure
      if (lowerWick > body * 0.3) {
        const wickPrice = low + lowerWick * 0.3;
        const row = ROWS - 1 - Math.floor(((wickPrice - minP) / (maxP - minP)) * ROWS);
        if (row >= 0 && row < ROWS) grid[col][row] += vol * 0.001 * lowerWick;
      }
    }

    setLiqTotal({ long: totalLong, short: totalShort });

    // Normalize grid
    let maxVal = 0;
    for (let ci = 0; ci < COLS; ci++)
      for (let ri = 0; ri < ROWS; ri++)
        if (grid[ci][ri] > maxVal) maxVal = grid[ci][ri];

    // Background
    ctx.fillStyle = '#080b14';
    ctx.fillRect(0, 0, W, H);

    // Draw cells
    if (maxVal > 0) {
      for (let ci = 0; ci < COLS; ci++) {
        for (let ri = 0; ri < ROWS; ri++) {
          const v = Math.pow(grid[ci][ri] / maxVal, 0.45); // gamma for better visual spread
          if (v < 0.02) continue;
          const [r, g, b, a] = heatColor(v);
          ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(2)})`;
          ctx.fillRect(Math.floor(ci * cellW), Math.floor(ri * cellH), Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
        }
      }
    }

    // Price line from candles
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,80,80,0.9)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(255,80,80,0.6)';
    ctx.shadowBlur = 4;
    for (let ci = 0; ci < candles.length && ci < COLS; ci++) {
      const price = parseFloat(candles[ci].c);
      const x = (ci + 0.5) * cellW;
      const y = H - ((price - minP) / (maxP - minP)) * H;
      if (ci === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Current price line
    const lastCandle = candles[candles.length - 1];
    const lastPrice = parseFloat(lastCandle?.c || '0');
    if (lastPrice) {
      setCurrentPrice(lastPrice);
      const y = H - ((lastPrice - minP) / (maxP - minP)) * H;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Y-axis price labels (right side, drawn on canvas)
    const labelCount = 6;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= labelCount; i++) {
      const pct = i / labelCount;
      const price = maxP - pct * (maxP - minP);
      const y = pct * H;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(price >= 1000 ? price.toFixed(0) : price.toPrecision(5), W - 4, y + 4);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.moveTo(0, y); ctx.lineTo(W - 60, y);
      ctx.stroke();
    }

  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const fetchData = async () => {
      try {
        const end = Date.now();
        const start = end - 48 * 3600 * 1000;
        const [candleRes, tradeRes] = await Promise.all([
          fetch(`/api/proxy?path=${encodeURIComponent(`kline?symbol=${symbol}&interval=1h&start_time=${start}&end_time=${end}`)}`),
          fetch(`/api/proxy?path=${encodeURIComponent(`trades?symbol=${symbol}&limit=1000`)}`),
        ]);
        if (cancelled) return;

        const candleJson = await candleRes.json();
        const tradeJson  = await tradeRes.json();

        const candles: Candle[] = (candleJson.success && Array.isArray(candleJson.data)) ? candleJson.data : [];
        const trades: Trade[]   = (tradeJson.success  && Array.isArray(tradeJson.data))  ? tradeJson.data  : [];

        if (!cancelled) {
          draw(candles, trades);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) { setError('Failed to load data'); setLoading(false); }
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [symbol, draw]);

  // Tooltip on mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { minPrice, maxPrice, minTime, maxTime } = metaRef.current;
    const price = maxPrice - (y / canvas.height) * (maxPrice - minPrice);
    const ts = minTime + (x / canvas.width) * (maxTime - minTime);
    const date = new Date(ts);
    const label = `${price >= 1000 ? price.toFixed(0) : price.toPrecision(4)}  ·  ${date.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}`;
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label });
  }, []);

  const fmtUSD = (v: number) => v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: 860, maxWidth: '96vw', background: '#0a0e1a', border: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            <CoinLogo symbol={symbol} size={24} />
            <div>
              <span className="text-[14px] font-bold text-white">{symbol.replace('-USD','')}</span>
              <span className="text-[11px] text-white/40 ml-2">Liquidation Heatmap · 48h · 1h candles</span>
            </div>
            {currentPrice > 0 && (
              <span className="text-[13px] font-mono font-bold text-white/80 ml-2">
                ${currentPrice >= 1000 ? currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 }) : currentPrice.toPrecision(5)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {(liqTotal.long > 0 || liqTotal.short > 0) && (
              <div className="flex gap-3 text-[11px]">
                <span className="text-danger/90">Long liq: <b>{fmtUSD(liqTotal.long)}</b></span>
                <span className="text-success/90">Short liq: <b>{fmtUSD(liqTotal.short)}</b></span>
              </div>
            )}
            <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-white/[0.05]">
          <span className="text-[10px] text-white/30 mr-1">Intensity:</span>
          {['#14082880','#001e5088','rgba(0,200,160,0.55)','rgba(180,230,50,0.75)','rgba(255,240,0,0.9)'].map((c, i) => (
            <div key={i} className="w-6 h-3 rounded-sm" style={{ background: c }} />
          ))}
          <span className="text-[10px] text-white/30 ml-1">Low → High liquidation density</span>
          <span className="text-[10px] text-white/30 ml-4">— <span style={{ color: 'rgba(255,80,80,0.9)' }}>Price</span></span>
        </div>

        {/* Canvas */}
        <div className="relative" style={{ height: 400 }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1a] z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-white/10 border-t-cyan-400 rounded-full animate-spin" />
                <span className="text-[12px] text-white/40">Loading {symbol} data...</span>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[12px] text-red-400">{error}</span>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={820}
            height={400}
            className="w-full h-full"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          />
          {tooltip && (
            <div className="absolute pointer-events-none px-2 py-1 rounded text-[10px] font-mono text-white/80"
              style={{
                left: Math.min(tooltip.x + 10, 700),
                top: Math.max(tooltip.y - 24, 0),
                background: 'rgba(0,0,0,0.75)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}>
              {tooltip.label}
            </div>
          )}
        </div>

        {/* X-axis time labels */}
        <div className="flex justify-between px-2 pb-2 pt-1">
          {Array.from({ length: 7 }, (_, i) => {
            const { minTime, maxTime } = metaRef.current;
            const ts = minTime + (i / 6) * (maxTime - minTime);
            return (
              <span key={i} className="text-[9px] text-white/25 font-mono">
                {new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' })}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
