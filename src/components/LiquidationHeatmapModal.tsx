'use client';
/**
 * LiquidationHeatmapModal — Coinglass-style dual-mode liquidation heatmap
 *
 * Layout:
 *   - X = time buckets (candle intervals)
 *   - Y = price levels
 *   - Each column = vertical bars:
 *       top half  (above price) = SHORT liq — red/orange heat
 *       bottom half (below price) = LONG liq  — cyan/green heat
 *   - Right side: dual legend (Short top, Long bottom)
 *   - Price line overlay (red)
 *   - Dollar labels on significant liq clusters
 *   - Crosshair + rich tooltip
 *   - Range filter: 12h / 24h / 48h / 7d
 *   - Side filter: All / Long / Short
 *   - Light + dark theme aware
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface Trade  { cause: string; side: string; price: string; amount: string; created_at: number; }

interface DbLiq { symbol: string; side: string; notional: number; ts: string; cause: string; }
interface Props { symbol: string; onClose: () => void; }

// ── Color scales ───────────────────────────────────────────────────────────────
// Short liq: dark red → orange → yellow → white
function shortColor(v: number): string {
  if (v <= 0) return 'transparent';
  type S = [number,number,number,number,number];
  const stops: S[] = [
    [0,    60,  0,  0, 0.15],
    [0.15,120, 10,  0, 0.35],
    [0.35,200, 50,  0, 0.58],
    [0.55,240,120,  0, 0.72],
    [0.75,255,200,  0, 0.85],
    [0.9, 255,230, 80, 0.93],
    [1,   255,255,200, 1   ],
  ];
  let lo = stops[0], hi = stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++) if(v>=stops[i][0]&&v<=stops[i+1][0]){lo=stops[i];hi=stops[i+1];break;}
  const t = lo[0]===hi[0] ? 0 : (v-lo[0])/(hi[0]-lo[0]);
  const l = (a:number,b:number)=>a+(b-a)*t;
  return `rgba(${Math.round(l(lo[1],hi[1]))},${Math.round(l(lo[2],hi[2]))},${Math.round(l(lo[3],hi[3]))},${l(lo[4],hi[4]).toFixed(2)})`;
}

// Long liq: dark teal → cyan → green → yellow-green
function longColor(v: number): string {
  if (v <= 0) return 'transparent';
  type S = [number,number,number,number,number];
  const stops: S[] = [
    [0,    0, 30, 50, 0.15],
    [0.15, 0, 80,100, 0.35],
    [0.35, 0,170,160, 0.58],
    [0.55, 0,210, 90, 0.72],
    [0.75, 80,230, 40, 0.85],
    [0.9, 180,240, 30, 0.93],
    [1,   220,255,100, 1   ],
  ];
  let lo = stops[0], hi = stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++) if(v>=stops[i][0]&&v<=stops[i+1][0]){lo=stops[i];hi=stops[i+1];break;}
  const t = lo[0]===hi[0] ? 0 : (v-lo[0])/(hi[0]-lo[0]);
  const l = (a:number,b:number)=>a+(b-a)*t;
  return `rgba(${Math.round(l(lo[1],hi[1]))},${Math.round(l(lo[2],hi[2]))},${Math.round(l(lo[3],hi[3]))},${l(lo[4],hi[4]).toFixed(2)})`;
}

const TIME_RANGES = [
  { label:'12h', hours:12,  interval:'15m', intervalMs:15*60*1000  },
  { label:'24h', hours:24,  interval:'1h',  intervalMs:60*60*1000  },
  { label:'48h', hours:48,  interval:'1h',  intervalMs:60*60*1000  },
  { label:'7d',  hours:168, interval:'4h',  intervalMs:4*60*60*1000},
];
type SideMode = 'all' | 'long' | 'short';

const ROWS = 120;
const LEGEND_W = 90;

function fmtPrice(p: number) {
  if (p >= 10000) return '$' + p.toLocaleString('en-US',{maximumFractionDigits:0});
  if (p >= 1)     return '$' + p.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if (p >= 0.001) return '$' + p.toPrecision(4);
  return '$' + p.toExponential(3);
}
function fmtUSD(v: number) {
  return v>=1e6?`$${(v/1e6).toFixed(2)}M`:v>=1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`;
}
function intensityLabel(v: number) {
  if (v > 0.85) return 'Extreme';
  if (v > 0.65) return 'Very High';
  if (v > 0.45) return 'High';
  if (v > 0.25) return 'Medium';
  return 'Low';
}

export default function LiquidationHeatmapModal({ symbol, onClose }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [rangeIdx, setRangeIdx] = useState(2); // default 48h
  const [sideMode, setSideMode] = useState<SideMode>('all');
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState('');
  const [stats,    setStats   ] = useState({ currentPrice:0, longLiq:0, shortLiq:0 });
  const [dbLiqs,   setDbLiqs  ] = useState<DbLiq[]>([]);
  const [tooltip,  setTooltip ] = useState<{
    x:number; y:number;
    date:string; price:string;
    liqVol:number; side:string; intensity:string;
  } | null>(null);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const metaRef = useRef({
    minP:0, maxP:0, minT:0, maxT:0, COLS:0,
    cellW:0, cellH:0, W:0, H:0,
    // per-col: liq notional bucketed by price row
    shortGrid: [] as number[][], // [col][row]
    longGrid:  [] as number[][], // [col][row]
    // per-col totals for labels
    colShortTotal: [] as number[],
    colLongTotal:  [] as number[],
    candles: [] as Candle[],
  });

  const render = useCallback((candles: Candle[], trades: Trade[], side: SideMode, dbLiqs: DbLiq[] = []) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width - LEGEND_W;
    const H = canvas.height;
    ctx.clearRect(0, 0, canvas.width, H);

    if (!candles.length) { setLoading(false); return; }

    // Price range
    const highs = candles.map(c => parseFloat(c.h));
    const lows  = candles.map(c => parseFloat(c.l));
    let maxP = Math.max(...highs);
    let minP = Math.min(...lows);
    const pad = (maxP - minP) * 0.1;
    maxP += pad; minP -= pad;

    // Time
    const times = candles.map(c => c.t > 1e12 ? c.t : c.t * 1000);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const COLS = candles.length;

    const cellW = W / COLS;
    const cellH = H / ROWS;

    // Build grids
    const shortGrid: number[][] = Array.from({length:COLS}, ()=>new Array(ROWS).fill(0));
    const longGrid:  number[][] = Array.from({length:COLS}, ()=>new Array(ROWS).fill(0));
    const colShortTotal = new Array(COLS).fill(0);
    const colLongTotal  = new Array(COLS).fill(0);
    let totalLong=0, totalShort=0;

    const addToGrid = (grid: number[][], colTotals: number[], ci: number, price: number, notional: number) => {
      const row = ROWS - 1 - Math.floor(((price - minP) / (maxP - minP)) * ROWS);
      if (row < 0 || row >= ROWS) return;
      // Spread across a band (Coinglass band effect)
      const spread = Math.max(1, Math.floor(ROWS * 0.02));
      for (let dr=-spread; dr<=spread; dr++) {
        const r = row + dr;
        if (r < 0 || r >= ROWS) continue;
        const w = 1 - Math.abs(dr) / (spread + 1);
        grid[ci][r] += notional * w;
      }
      colTotals[ci] += notional;
    };

    // Real trades
    for (const t of trades) {
      const isLiq = t.cause==='market_liquidation'||t.cause==='backstop_liquidation'
        ||(typeof t.cause==='string'&&t.cause.toLowerCase().includes('liq'));
      if (!isLiq) continue;
      const ts = t.created_at > 1e12 ? t.created_at : t.created_at * 1000;
      const price = parseFloat(t.price);
      const notional = price * parseFloat(t.amount);
      if (!notional||isNaN(notional)) continue;
      const ci = Math.min(Math.floor(((ts-minT)/(maxT-minT+1))*COLS), COLS-1);
      if (ci < 0) continue;
      const isLong = t.side?.includes('long');
      if (isLong) { totalLong+=notional; addToGrid(longGrid, colLongTotal, ci, price, notional); }
      else        { totalShort+=notional; addToGrid(shortGrid, colShortTotal, ci, price, notional); }
    }

    // Synthetic bands from candle wicks (gives density when real liq data is sparse)
    for (let ci=0; ci<candles.length; ci++) {
      const c = candles[ci];
      const high  = parseFloat(c.h), low  = parseFloat(c.l);
      const open  = parseFloat(c.o), close= parseFloat(c.c);
      const vol   = parseFloat(c.v);
      const body  = Math.abs(close-open);
      const upperWick = high - Math.max(open,close);
      const lowerWick = Math.min(open,close) - low;
      const scale = vol * 0.0002;
      if (upperWick > body*0.15) addToGrid(shortGrid, colShortTotal, ci, high, upperWick*scale);
      if (lowerWick > body*0.15) addToGrid(longGrid,  colLongTotal,  ci, low,  lowerWick*scale);
    }

    // Normalize separately for long/short
    let maxShort=0, maxLong=0;
    for (let ci=0;ci<COLS;ci++) for(let ri=0;ri<ROWS;ri++) {
      if (shortGrid[ci][ri]>maxShort) maxShort=shortGrid[ci][ri];
      if (longGrid[ci][ri] >maxLong ) maxLong =longGrid[ci][ri];
    }
    const normShort=(v:number)=>maxShort>0?Math.pow(v/maxShort,0.45):0;
    const normLong =(v:number)=>maxLong >0?Math.pow(v/maxLong, 0.45):0;

    metaRef.current = { minP, maxP, minT, maxT, COLS, cellW, cellH, W, H,
      shortGrid, longGrid, colShortTotal, colLongTotal, candles };

    // ── Background ────────────────────────────────────────────────────
    ctx.fillStyle = isDark ? '#06091a' : '#f0f4f8';
    ctx.fillRect(0, 0, W, H);

    // ── Heatmap cells ─────────────────────────────────────────────────
    for (let ci=0; ci<COLS; ci++) {
      const closePx = parseFloat(candles[ci]?.c||'0');
      const priceRow = ROWS-1-Math.floor(((closePx-minP)/(maxP-minP))*ROWS);

      for (let ri=0; ri<ROWS; ri++) {
        const abovePrice = ri <= priceRow;
        // Above price → short liq zone; below → long liq zone
        let color = 'transparent';
        if ((side==='all'||side==='short') && abovePrice) {
          const v = normShort(shortGrid[ci][ri]);
          if (v > 0.03) color = shortColor(v);
        }
        if ((side==='all'||side==='long') && !abovePrice) {
          const v = normLong(longGrid[ci][ri]);
          if (v > 0.03) color = longColor(v);
        }
        if (color==='transparent') continue;
        ctx.fillStyle = color;
        ctx.fillRect(Math.floor(ci*cellW), Math.floor(ri*cellH), Math.ceil(cellW)+1, Math.ceil(cellH)+1);
      }
    }

    // ── Subtle horizontal grid lines ──────────────────────────────────
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let i=1; i<8; i++) {
      const y = (i/8)*H;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }

    // ── Dollar labels for high-liq columns ───────────────────────────
    ctx.font = 'bold 9px ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    const labelThreshold = Math.max(maxShort, maxLong) * 0.25;
    for (let ci=0; ci<COLS; ci++) {
      const cx = (ci+0.5)*cellW;
      if ((side==='all'||side==='short') && colShortTotal[ci] > labelThreshold*5) {
        // Find peak row for label placement
        let peakRow=0, peakVal=0;
        for (let ri=0;ri<ROWS/2;ri++) if(shortGrid[ci][ri]>peakVal){peakVal=shortGrid[ci][ri];peakRow=ri;}
        const y = Math.max(8, peakRow*cellH - 2);
        ctx.fillStyle='rgba(255,200,0,0.9)';
        ctx.fillText(fmtUSD(colShortTotal[ci])+' [S]', cx, y);
      }
      if ((side==='all'||side==='long') && colLongTotal[ci] > labelThreshold*5) {
        let peakRow=ROWS-1, peakVal=0;
        for (let ri=ROWS/2;ri<ROWS;ri++) if(longGrid[ci][ri]>peakVal){peakVal=longGrid[ci][ri];peakRow=ri;}
        const y = Math.min(H-4, peakRow*cellH + 10);
        ctx.fillStyle='rgba(100,255,180,0.9)';
        ctx.fillText(fmtUSD(colLongTotal[ci])+' [L]', cx, y);
      }
    }

    // ── Real liquidation dots from Supabase ──────────────────────────
    if (dbLiqs.length > 0) {
      for (const liq of dbLiqs) {
        const ts = new Date(liq.ts).getTime();
        if (ts < minT - 3600000 || ts > maxT + 3600000) continue;
        const ci = Math.min(Math.max(Math.floor(((ts - minT) / (maxT - minT + 1)) * COLS), 0), COLS - 1);
        const candle = candles[ci];
        if (!candle) continue;
        const price = parseFloat(candle.c);
        const x = (ci + 0.5) * cellW;
        const y = H - ((price - minP) / (maxP - minP)) * H;
        const isLong = liq.side?.includes('long');
        const notional = Number(liq.notional) || 0;
        const dotR = Math.max(3, Math.min(9, 3 + Math.log10(Math.max(notional, 100))));
        // Glow
        ctx.beginPath();
        ctx.arc(x, y, dotR + 4, 0, Math.PI * 2);
        ctx.fillStyle = isLong ? 'rgba(255,60,60,0.12)' : 'rgba(0,220,120,0.12)';
        ctx.fill();
        // Dot
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = isLong ? 'rgba(255,80,80,0.9)' : 'rgba(0,230,130,0.9)';
        ctx.fill();
      }
    }

    // ── Price line ────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle='#ff3344';
    ctx.lineWidth=1.5;
    ctx.shadowColor='rgba(255,40,60,0.5)';
    ctx.shadowBlur=4;
    for (let ci=0; ci<candles.length; ci++) {
      const price = parseFloat(candles[ci].c);
      const x = (ci+0.5)*cellW;
      const y = H - ((price-minP)/(maxP-minP))*H;
      if (ci===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.shadowBlur=0;

    // ── Current price dashed line ─────────────────────────────────────
    const lastPrice = parseFloat(candles[candles.length-1]?.c||'0');
    if (lastPrice) {
      const y = H - ((lastPrice-minP)/(maxP-minP))*H;
      ctx.setLineDash([5,5]);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Y-axis price labels ────────────────────────────────────────────
    const lc = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
    const lbg= isDark ? 'rgba(6,9,26,0.75)'     : 'rgba(240,244,248,0.85)';
    ctx.font='10px ui-monospace,monospace';
    ctx.textAlign='right';
    for (let i=0;i<=7;i++) {
      const pct=i/7;
      const price=maxP-pct*(maxP-minP);
      const y=pct*H;
      const label=fmtPrice(price);
      const tw=ctx.measureText(label).width;
      ctx.fillStyle=lbg;
      ctx.fillRect(W-tw-12,y-8,tw+10,14);
      ctx.fillStyle=lc;
      ctx.fillText(label,W-4,y+4);
    }

    // ── Right legend ───────────────────────────────────────────────────
    const lx = W + 4;
    const lgBarH = H/2 - 30;

    // Short legend (top)
    ctx.font='bold 9px ui-sans-serif,sans-serif';
    ctx.textAlign='left';
    ctx.fillStyle= isDark ? 'rgba(255,100,100,0.9)' : 'rgba(200,0,0,0.8)';
    ctx.fillText('Short', lx, 14);
    const shortTiers = ['>$2M','$750k–$2M','$250k–$750k','$0k–$250k'];
    const shortVals  = [1, 0.65, 0.35, 0.12];
    for (let i=0;i<4;i++) {
      const y=22+i*((lgBarH)/4);
      ctx.fillStyle=shortColor(shortVals[i]);
      ctx.fillRect(lx,y,12,lgBarH/4-2);
      ctx.fillStyle= isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
      ctx.font='8px ui-monospace,monospace';
      ctx.fillText(shortTiers[i],lx+14,y+8);
    }

    // Divider
    ctx.strokeStyle= isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(W,H/2); ctx.lineTo(canvas.width,H/2); ctx.stroke();

    // Long legend (bottom)
    ctx.font='bold 9px ui-sans-serif,sans-serif';
    ctx.fillStyle= isDark ? 'rgba(80,220,180,0.9)' : 'rgba(0,140,100,0.8)';
    ctx.fillText('Long', lx, H/2+14);
    const longTiers = ['>$2M','$750k–$2M','$250k–$750k','$0k–$250k'];
    const longVals  = [1, 0.65, 0.35, 0.12];
    for (let i=0;i<4;i++) {
      const y=H/2+22+i*((lgBarH)/4);
      ctx.fillStyle=longColor(longVals[i]);
      ctx.fillRect(lx,y,12,lgBarH/4-2);
      ctx.fillStyle= isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
      ctx.font='8px ui-monospace,monospace';
      ctx.fillText(longTiers[i],lx+14,y+8);
    }

    setStats({ currentPrice:lastPrice, longLiq:totalLong, shortLiq:totalShort });
    setLoading(false);
  }, [isDark]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const range = TIME_RANGES[rangeIdx];
    const end   = Date.now();
    const start = end - range.hours * 3600000;

    Promise.all([
      fetch(`/api/proxy?path=${encodeURIComponent(`kline?symbol=${symbol}&interval=${range.interval}&start_time=${start}&end_time=${end}`)}`).then(r=>r.json()),
      fetch(`/api/proxy?path=${encodeURIComponent(`trades?symbol=${symbol}&limit=1000`)}`).then(r=>r.json()),
      fetch(`/api/liquidations/recent?hours=${range.hours}&symbol=${encodeURIComponent(symbol)}`).then(r=>r.ok?r.json():[]).catch(()=>[]),
    ]).then(([cj,tj,dbData]) => {
      if (cancelled) return;
      const candles: Candle[] = cj.success&&Array.isArray(cj.data) ? cj.data : [];
      const trades:  Trade[]  = tj.success&&Array.isArray(tj.data)  ? tj.data  : [];
      const liqs: DbLiq[]     = Array.isArray(dbData) ? dbData : [];
      setDbLiqs(liqs);
      render(candles, trades, sideMode, liqs);
    }).catch(()=>{ if(!cancelled){setError('Failed to load data');setLoading(false);} });

    return ()=>{ cancelled=true; };
  }, [symbol, rangeIdx, sideMode, render]);

  // Crosshair + tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const { minP, maxP, minT, maxT, COLS, cellW, cellH, W, H, shortGrid, longGrid, colShortTotal, colLongTotal, candles } = metaRef.current;
    if (!COLS) return;

    const price = maxP - (my/H)*(maxP-minP);
    const ts    = minT + (mx/W)*(maxT-minT);
    const col   = Math.min(Math.floor(mx/cellW), COLS-1);
    const row   = Math.min(Math.floor(my/cellH), ROWS-1);

    // Crosshair
    const oc = overlayRef.current;
    if (oc) {
      const oc2 = oc.getContext('2d');
      if (oc2) {
        oc2.clearRect(0,0,oc.width,oc.height);
        // Vertical dotted line
        oc2.strokeStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';
        oc2.setLineDash([4,4]); oc2.lineWidth=1;
        oc2.beginPath(); oc2.moveTo(mx,0); oc2.lineTo(mx,H); oc2.stroke();
        oc2.beginPath(); oc2.moveTo(0,my); oc2.lineTo(W,my); oc2.stroke();
        oc2.setLineDash([]);
      }
    }

    const candle = candles[Math.min(col, candles.length-1)];
    const closePrice = candle ? parseFloat(candle.c) : price;
    const abovePrice = my < H - ((closePrice-minP)/(maxP-minP))*H;
    const sv = col>=0&&col<COLS&&row>=0&&row<ROWS ? (shortGrid[col]?.[row]??0) : 0;
    const lv = col>=0&&col<COLS&&row>=0&&row<ROWS ? (longGrid[col]?.[row]??0)  : 0;

    let liqVol = 0, sideLabel = '';
    if (abovePrice) { liqVol = colShortTotal[col]||0; sideLabel='Short Liquidation'; }
    else            { liqVol = colLongTotal[col]||0;  sideLabel='Long Liquidation';  }

    const maxVal = Math.max(sv, lv);
    const intensity = maxVal > 0 ? Math.pow(maxVal / Math.max(...shortGrid.concat(longGrid).map(col => Math.max(...col))), 0.45) : 0;

    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      date: new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''),
      price: fmtPrice(closePrice),
      liqVol,
      side: sideLabel,
      intensity: intensity>0.05 ? intensityLabel(intensity) : '',
    });
  }, [isDark]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    const oc = overlayRef.current;
    if (oc) oc.getContext('2d')?.clearRect(0,0,oc.width,oc.height);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown', h);
    return ()=>window.removeEventListener('keydown', h);
  }, [onClose]);

  const bgModal  = isDark ? '#07091c' : '#ffffff';
  const bgBar    = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
  const border   = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
  const text1    = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const text2    = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background:'rgba(0,0,0,0.65)', backdropFilter:'blur(6px)' }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}
    >
      <div className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ width:1020, maxWidth:'97vw', background:bgModal, border:`1px solid ${border}`, boxShadow:'0 25px 60px rgba(0,0,0,0.6)' }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5" style={{ background:bgBar, borderBottom:`1px solid ${border}` }}>
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={symbol} size={22} />
            <div>
              <span className="text-[15px] font-bold tracking-tight" style={{ color:text1 }}>
                LiquidationHeatmap
              </span>
              <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background:'rgba(0,180,216,0.12)', color:'#00d4ff' }}>
                {symbol.replace('-USD','')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(stats.longLiq>0||stats.shortLiq>0) && (
              <div className="flex gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-md font-semibold" style={{ background:'rgba(248,113,113,0.12)', color:'#f87171', border:'1px solid rgba(248,113,113,0.2)' }}>
                  Long liq: <b>{fmtUSD(stats.longLiq)}</b>
                </span>
                <span className="px-2 py-0.5 rounded-md font-semibold" style={{ background:'rgba(74,222,128,0.12)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.2)' }}>
                  Short liq: <b>{fmtUSD(stats.shortLiq)}</b>
                </span>
              </div>
            )}
            {stats.currentPrice>0 && (
              <span className="font-mono text-[13px] font-bold px-2.5 py-1 rounded-lg" style={{ background:'rgba(0,180,216,0.08)', color:'#00d4ff', border:'1px solid rgba(0,180,216,0.2)' }}>
                {fmtPrice(stats.currentPrice)}
              </span>
            )}
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-[14px] leading-none hover:opacity-70 transition-opacity" style={{ color:text2, background:'rgba(255,255,255,0.06)' }}>✕</button>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="flex items-center gap-5 px-5 py-2.5" style={{ borderBottom:`1px solid ${border}`, background:bgBar }}>
          {/* Range */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color:text2 }}>Range</span>
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${border}` }}>
              {TIME_RANGES.map((r,i) => (
                <button key={r.label} onClick={()=>setRangeIdx(i)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background: rangeIdx===i ? (isDark?'rgba(0,180,216,0.2)':'rgba(0,0,0,0.1)') : 'transparent',
                    color: rangeIdx===i ? '#00d4ff' : text2,
                    boxShadow: rangeIdx===i ? '0 0 0 1px rgba(0,180,216,0.3)' : 'none',
                  }}>{r.label}</button>
              ))}
            </div>
          </div>

          <div className="w-px h-4" style={{ background:border }} />

          {/* Side filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color:text2 }}>Side</span>
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${border}` }}>
              {(['all','long','short'] as SideMode[]).map(s => (
                <button key={s} onClick={()=>setSideMode(s)}
                  className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background: sideMode===s
                      ? s==='long'  ? 'rgba(74,222,128,0.18)'
                      : s==='short' ? 'rgba(248,113,113,0.18)'
                      : (isDark?'rgba(0,180,216,0.15)':'rgba(0,0,0,0.07)')
                      : 'transparent',
                    color: sideMode===s
                      ? s==='long'  ? '#4ade80'
                      : s==='short' ? '#f87171'
                      : '#00d4ff'
                      : text2,
                    boxShadow: sideMode===s
                      ? s==='long'  ? '0 0 0 1px rgba(74,222,128,0.3)'
                      : s==='short' ? '0 0 0 1px rgba(248,113,113,0.3)'
                      : '0 0 0 1px rgba(0,180,216,0.3)'
                      : 'none',
                  }}>
                  {s.charAt(0).toUpperCase()+s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Price legend strip */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color:'#f87171' }}>Short</span>
              <div className="flex gap-0.5">
                {[0.08,0.3,0.6,0.9].map((v,i)=>(
                  <div key={i} className="w-5 h-2.5 rounded-sm" style={{ background:shortColor(v) }} />
                ))}
              </div>
            </div>
            <div className="w-px h-3" style={{ background:border }} />
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color:'#4ade80' }}>Long</span>
              <div className="flex gap-0.5">
                {[0.08,0.3,0.6,0.9].map((v,i)=>(
                  <div key={i} className="w-5 h-2.5 rounded-sm" style={{ background:longColor(v) }} />
                ))}
              </div>
            </div>
            <div className="w-px h-3" style={{ background:border }} />
            <div className="flex items-center gap-1">
              <div className="w-5 h-0.5" style={{ background:'#ff3344' }} />
              <span className="text-[10px] font-semibold" style={{ color:'#ff3344' }}>Price</span>
            </div>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div className="relative" style={{ height:440 }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background:bgModal }}>
              <div className="w-7 h-7 border-2 rounded-full animate-spin mb-2"
                style={{ borderColor:isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)', borderTopColor:'#00d4ff' }} />
              <span className="text-[11px]" style={{ color:text2 }}>Loading {symbol.replace('-USD','')} data...</span>
            </div>
          )}
          {error&&!loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-red-400 text-[12px]">{error}</span>
            </div>
          )}
          <canvas ref={canvasRef}  width={1020} height={440} className="absolute inset-0 w-full h-full" />
          <canvas ref={overlayRef} width={1020} height={440} className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />

          {tooltip && (
            <div className="absolute pointer-events-none rounded-xl px-3 py-2.5 text-[11px]"
              style={{
                left: Math.min(tooltip.x+14, 720),
                top:  Math.max(tooltip.y-10, 4),
                background: isDark?'rgba(4,8,28,0.95)':'rgba(255,255,255,0.97)',
                border:`1px solid ${border}`,
                color:text1,
                boxShadow:'0 8px 30px rgba(0,0,0,0.4)',
                minWidth:170,
              }}>
              <div className="font-semibold mb-1" style={{ color:text2 }}>Date: {tooltip.date}</div>
              <div className="mb-0.5">Price: <span className="font-mono font-bold">{tooltip.price}</span></div>
              {tooltip.liqVol>0&&<div>Total Liq Vol: <span className="font-bold">{fmtUSD(tooltip.liqVol)}</span></div>}
              {tooltip.side&&(
                <div style={{ color:tooltip.side.includes('Short')?'#f87171':'#4ade80' }}>
                  Side: {tooltip.side}
                </div>
              )}
              {tooltip.intensity&&<div style={{ color:'#facc15' }}>Intensity: {tooltip.intensity}</div>}
            </div>
          )}
        </div>

        {/* ── X-axis labels ── */}
        <div className="flex justify-between px-3 py-1.5" style={{ borderTop:`1px solid ${border}`, background:bgBar }}>
          {Array.from({length:8},(_,i)=>{
            const {minT,maxT}=metaRef.current;
            const ts = minT&&maxT ? minT+(i/7)*(maxT-minT) : 0;
            return (
              <span key={i} className="text-[9px] font-mono" style={{ color:text2 }}>
                {ts?new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''):'—'}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
