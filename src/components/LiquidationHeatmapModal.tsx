'use client';
/**
 * LiquidationHeatmapModal
 * Coinglass-style heatmap: fiyat × zaman ekseninde liquidation yoğunluğu
 * 
 * Veri kaynakları:
 * - Pacifica: anlık kline (OHLCV) + trade stream
 * - Binance/Bybit/HyperLiquid: liq verileri /api/liquidations/recent'tan
 * 
 * Canvas render:
 * - Y ekseni: fiyat seviyeleri (minP → maxP)
 * - X ekseni: zaman dilimleri
 * - Renk: short liq = kırmızı/sarı, long liq = teal/yeşil
 * - Sağda: kümülatif liq bar chart
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface LiqEntry { symbol: string; side: string; notional: number; price: number; ts: string; source: string; }
interface LiqSummary { long: number; short: number; total: number; count: number; }
interface Props { symbol: string; onClose: () => void; }

// ── Color scales ───────────────────────────────────────────────────────────────
function shortColor(v: number): string {
  if (v <= 0) return 'transparent';
  type S = [number,number,number,number,number];
  const stops: S[] = [
    [0,    60,  0,   0, 0.1],
    [0.15,130, 10,   0, 0.35],
    [0.35,200, 50,   0, 0.58],
    [0.55,240,120,   0, 0.72],
    [0.75,255,200,   0, 0.85],
    [0.9, 255,230,  80, 0.93],
    [1,   255,255, 200, 1   ],
  ];
  let lo = stops[0], hi = stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++) if(v>=stops[i][0]&&v<=stops[i+1][0]){lo=stops[i];hi=stops[i+1];break;}
  const t = lo[0]===hi[0]?0:(v-lo[0])/(hi[0]-lo[0]);
  const l = (a:number,b:number)=>Math.round(a+(b-a)*t);
  return `rgba(${l(lo[1],hi[1])},${l(lo[2],hi[2])},${l(lo[3],hi[3])},${(lo[4]+(hi[4]-lo[4])*t).toFixed(2)})`;
}

function longColor(v: number): string {
  if (v <= 0) return 'transparent';
  type S = [number,number,number,number,number];
  const stops: S[] = [
    [0,    0,  30,  50, 0.1],
    [0.15, 0,  80, 100, 0.35],
    [0.35, 0, 170, 160, 0.58],
    [0.55, 0, 210,  90, 0.72],
    [0.75,80, 230,  40, 0.85],
    [0.9,180, 240,  30, 0.93],
    [1,  220, 255, 100, 1   ],
  ];
  let lo = stops[0], hi = stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++) if(v>=stops[i][0]&&v<=stops[i+1][0]){lo=stops[i];hi=stops[i+1];break;}
  const t = lo[0]===hi[0]?0:(v-lo[0])/(hi[0]-lo[0]);
  const l = (a:number,b:number)=>Math.round(a+(b-a)*t);
  return `rgba(${l(lo[1],hi[1])},${l(lo[2],hi[2])},${l(lo[3],hi[3])},${(lo[4]+(hi[4]-lo[4])*t).toFixed(2)})`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtP = (p: number) => p>=10000?'$'+p.toLocaleString('en-US',{maximumFractionDigits:0})
  :p>=1?'$'+p.toFixed(2):'$'+p.toPrecision(4);
const fmtU = (v: number) => v>=1e6?`$${(v/1e6).toFixed(2)}M`:v>=1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`;

const RANGES = [
  {label:'12h', hours:12,  interval:'15m', ms:15*60*1000 },
  {label:'24h', hours:24,  interval:'1h',  ms:60*60*1000 },
  {label:'48h', hours:48,  interval:'1h',  ms:60*60*1000 },
  {label:'7d',  hours:168, interval:'4h',  ms:4*60*60*1000},
];
type Side = 'all'|'long'|'short';
const ROWS = 120;
const RIGHT_W = 80; // kümülatif bar alanı

const SOURCE_COLORS: Record<string,string> = {
  pacifica:'#00d4ff', binance:'#F0B90B', hyperliquid:'#00E5CF', bybit:'#F7A600',
};

// ── Component ──────────────────────────────────────────────────────────────────
export default function LiquidationHeatmapModal({ symbol, onClose }: Props) {
  const mainRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [rangeIdx, setRangeIdx] = useState(1); // default 24h
  const [side,     setSide    ] = useState<Side>('all');
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState('');
  const [stats,    setStats   ] = useState<{price:number;longLiq:number;shortLiq:number;sources:Record<string,LiqSummary>}>({price:0,longLiq:0,shortLiq:0,sources:{}});
  const [tooltip,  setTooltip ] = useState<{x:number;y:number;price:string;date:string;liqVol:number;side:string}|null>(null);

  const metaRef = useRef({
    minP:0, maxP:0, minT:0, maxT:0, COLS:0, cellW:0, cellH:0, W:0, H:0,
    shortGrid:[] as number[][], longGrid:[] as number[][],
    colShort:[] as number[], colLong:[] as number[],
    // kümülatif fiyat bazlı liq (sağ bar chart için)
    priceLong:new Array(ROWS).fill(0), priceShort:new Array(ROWS).fill(0),
    candles:[] as Candle[],
  });

  const coin = symbol.replace(/-USD$/i,'').replace(/-PERP$/i,'');

  // ── Ana render fonksiyonu ────────────────────────────────────────────────────
  const drawCanvas = useCallback((
    candles: Candle[],
    liqs: LiqEntry[],
    sideMode: Side,
  ) => {
    const canvas = mainRef.current;
    if (!canvas || !candles.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const W = canvas.width - RIGHT_W;
    const H = canvas.height;
    ctx.clearRect(0, 0, canvas.width, H);

    // Fiyat aralığı
    const allH = candles.map(c=>parseFloat(c.h));
    const allL = candles.map(c=>parseFloat(c.l));
    let maxP = Math.max(...allH);
    let minP = Math.min(...allL);
    const pad = (maxP-minP)*0.08;
    maxP += pad; minP -= pad;

    // Zaman
    const times = candles.map(c=>c.t>1e12?c.t:c.t*1000);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const COLS = candles.length;
    const cellW = W/COLS;
    const cellH = H/ROWS;

    // Grid oluştur
    const shortGrid = Array.from({length:COLS},()=>new Array(ROWS).fill(0));
    const longGrid  = Array.from({length:COLS},()=>new Array(ROWS).fill(0));
    const colShort  = new Array(COLS).fill(0);
    const colLong   = new Array(COLS).fill(0);
    const priceLong  = new Array(ROWS).fill(0);
    const priceShort = new Array(ROWS).fill(0);

    let totalLong = 0, totalShort = 0;

    const addToGrid = (grid: number[][], colTotals: number[], rowTotals: number[], ci: number, price: number, notional: number) => {
      if (ci < 0 || ci >= COLS) return;
      const rowRaw = (price-minP)/(maxP-minP)*ROWS;
      const row = ROWS-1-Math.floor(rowRaw);
      if (row < 0 || row >= ROWS) return;
      const spread = Math.max(1, Math.floor(ROWS*0.018));
      for (let dr=-spread; dr<=spread; dr++) {
        const r = row+dr;
        if (r<0||r>=ROWS) continue;
        const w = 1-Math.abs(dr)/(spread+1);
        grid[ci][r] += notional*w;
      }
      colTotals[ci] += notional;
      if (row>=0&&row<ROWS) rowTotals[row] += notional;
    };

    // Liq verilerini grid'e yaz
    for (const liq of liqs) {
      const ts = new Date(liq.ts).getTime();
      if (!ts || ts < minT-3600000) continue;
      const ci = Math.min(Math.max(Math.floor(((ts-minT)/(maxT-minT+1))*COLS),0),COLS-1);
      const price = liq.price > 0 ? liq.price : parseFloat(candles[ci]?.c ?? '0');
      if (!price) continue;
      const isLong = liq.side==='long';
      if (isLong) {
        totalLong += liq.notional;
        addToGrid(longGrid, colLong, priceLong, ci, price, liq.notional);
      } else {
        totalShort += liq.notional;
        addToGrid(shortGrid, colShort, priceShort, ci, price, liq.notional);
      }
    }

    // Wick-bazlı sentetik density (candle verisiyle doldur — liq verisi seyrekse)
    for (let ci=0; ci<candles.length; ci++) {
      const c = candles[ci];
      const high=parseFloat(c.h), low=parseFloat(c.l);
      const open=parseFloat(c.o), close=parseFloat(c.c);
      const vol=parseFloat(c.v);
      const upperWick = high-Math.max(open,close);
      const lowerWick = Math.min(open,close)-low;
      const body = Math.abs(close-open);
      const scale = vol*0.00015;
      if (upperWick>body*0.2) addToGrid(shortGrid, colShort, priceShort, ci, high-upperWick*0.3, upperWick*scale);
      if (lowerWick>body*0.2) addToGrid(longGrid,  colLong,  priceLong,  ci, low +lowerWick*0.3, lowerWick*scale);
    }

    // Normalize
    let maxS=0, maxL=0;
    for (let ci=0;ci<COLS;ci++) for(let ri=0;ri<ROWS;ri++){
      if(shortGrid[ci][ri]>maxS) maxS=shortGrid[ci][ri];
      if(longGrid[ci][ri] >maxL) maxL=longGrid[ci][ri];
    }
    const normS = (v:number)=>maxS>0?Math.pow(v/maxS,0.42):0;
    const normL = (v:number)=>maxL>0?Math.pow(v/maxL,0.42):0;

    // Meta kaydet
    metaRef.current = { minP,maxP,minT,maxT,COLS,cellW,cellH,W,H,
      shortGrid,longGrid,colShort,colLong,priceLong,priceShort,candles };

    // ── BG ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = isDark ? '#06091a' : '#f0f4f8';
    ctx.fillRect(0,0,W,H);

    // ── Heatmap cells ────────────────────────────────────────────────────────
    for (let ci=0; ci<COLS; ci++) {
      const closePrice = parseFloat(candles[ci]?.c||'0');
      const priceRow = ROWS-1-Math.floor(((closePrice-minP)/(maxP-minP))*ROWS);

      for (let ri=0; ri<ROWS; ri++) {
        const abovePrice = ri <= priceRow;
        let color = '';
        if ((sideMode==='all'||sideMode==='short') && abovePrice) {
          const v = normS(shortGrid[ci][ri]);
          if (v>0.04) color = shortColor(v);
        }
        if ((sideMode==='all'||sideMode==='long') && !abovePrice) {
          const v = normL(longGrid[ci][ri]);
          if (v>0.04) color = longColor(v);
        }
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(Math.floor(ci*cellW), Math.floor(ri*cellH), Math.ceil(cellW)+1, Math.ceil(cellH)+1);
      }
    }

    // ── Grid lines ──────────────────────────────────────────────────────────
    ctx.strokeStyle = isDark?'rgba(255,255,255,0.035)':'rgba(0,0,0,0.04)';
    ctx.lineWidth = 1;
    for (let i=1;i<8;i++){
      const y=(i/8)*H;
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
    }

    // ── Fiyat çizgisi ────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle='#ff3344';
    ctx.lineWidth=1.5;
    ctx.shadowColor='rgba(255,50,70,0.5)';
    ctx.shadowBlur=4;
    let started = false;
    for (let ci=0;ci<candles.length;ci++) {
      const price=parseFloat(candles[ci].c);
      const x=(ci+0.5)*cellW;
      const y=H-((price-minP)/(maxP-minP))*H;
      if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.shadowBlur=0;

    // ── Y-axis fiyat etiketleri ──────────────────────────────────────────────
    ctx.font='10px ui-monospace,monospace';
    ctx.textAlign='right';
    const lc  = isDark?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.55)';
    const lbg = isDark?'rgba(6,9,26,0.8)':'rgba(240,244,248,0.9)';
    for (let i=0;i<=7;i++){
      const pct=i/7;
      const price=maxP-pct*(maxP-minP);
      const y=pct*H;
      const label=fmtP(price);
      const tw=ctx.measureText(label).width;
      ctx.fillStyle=lbg;
      ctx.fillRect(W-tw-14,y-8,tw+10,15);
      ctx.fillStyle=lc;
      ctx.fillText(label,W-4,y+4);
    }

    // ── Sağ panel: kümülatif liq bar chart ──────────────────────────────────
    const rx = W+2;
    const rw = RIGHT_W-4;
    ctx.fillStyle = isDark?'rgba(0,0,0,0.5)':'rgba(200,210,230,0.5)';
    ctx.fillRect(rx,0,rw,H);

    const maxPS = Math.max(...priceShort,1);
    const maxPL = Math.max(...priceLong,1);
    const maxPAll = Math.max(maxPS,maxPL);

    for (let ri=0;ri<ROWS;ri++) {
      const y  = ri*cellH;
      const sh = priceShort[ri];
      const lo = priceLong[ri];
      if (sh>0) {
        const bw = (sh/maxPAll)*rw*0.9;
        const vn = Math.pow(sh/maxPS,0.5);
        ctx.fillStyle=shortColor(Math.min(vn,1));
        ctx.fillRect(rx,y,bw,Math.max(cellH-1,1));
      }
      if (lo>0) {
        const bw = (lo/maxPAll)*rw*0.9;
        const vn = Math.pow(lo/maxPL,0.5);
        ctx.fillStyle=longColor(Math.min(vn,1));
        ctx.fillRect(rx,y,bw,Math.max(cellH-1,1));
      }
    }

    // Sağ panel border
    ctx.strokeStyle=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.1)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(rx,0);ctx.lineTo(rx,H);ctx.stroke();

    setStats(s=>({...s, price:parseFloat(candles[candles.length-1]?.c||'0'), longLiq:totalLong, shortLiq:totalShort}));
    setLoading(false);
  }, []);

  // ── Veri fetch ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const range = RANGES[rangeIdx];
    const end   = Date.now();
    const start = end - range.hours*3600000;

    Promise.all([
      // Pacifica kline
      fetch(`/api/proxy?path=${encodeURIComponent(`kline?symbol=${symbol}&interval=${range.interval}&start_time=${start}&end_time=${end}`)}`)
        .then(r=>r.json()).catch(()=>({success:false,data:[]})),
      // Liq verisi (4 kaynak)
      fetch(`/api/liquidations/recent?hours=${range.hours}&symbol=${encodeURIComponent(symbol)}`)
        .then(r=>r.ok?r.json():{events:[],summary:{}}).catch(()=>({events:[],summary:{}})),
    ]).then(([klineJson, liqData]) => {
      if (cancelled) return;
      const candles: Candle[] = klineJson?.success&&Array.isArray(klineJson.data) ? klineJson.data : [];
      const liqs: LiqEntry[]  = Array.isArray(liqData?.events) ? liqData.events : [];
      const summary           = liqData?.summary ?? {};

      if (!candles.length) {
        setError('Kline verisi alınamadı');
        setLoading(false);
        return;
      }

      setStats(s=>({...s, sources: summary}));
      drawCanvas(candles, liqs, side);
    }).catch(err => {
      if (!cancelled) { setError('Veri yüklenemedi: '+String(err)); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [symbol, rangeIdx, side, drawCanvas]);

  // ── Crosshair ────────────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const oc = overlayRef.current;
    if (!oc) return;
    const rect = oc.getBoundingClientRect();
    const mx = (e.clientX-rect.left)*(oc.width/rect.width);
    const my = (e.clientY-rect.top) *(oc.height/rect.height);
    const { minP,maxP,minT,maxT,COLS,cellW,cellH,W,H,shortGrid,longGrid,colShort,colLong,candles } = metaRef.current;
    if (!COLS||!W) return;

    const isDark = typeof document!=='undefined'&&document.documentElement.classList.contains('dark');
    const ctx = oc.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0,0,oc.width,oc.height);

    if (mx>W) return; // sağ panel bölgesinde crosshair yok

    const col = Math.min(Math.max(Math.floor(mx/cellW),0),COLS-1);
    const row = Math.min(Math.max(Math.floor(my/cellH),0),ROWS-1);
    const price = maxP-(my/H)*(maxP-minP);
    const ts    = minT+(mx/W)*(maxT-minT);

    // Crosshair çizgileri
    ctx.strokeStyle=isDark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.3)';
    ctx.setLineDash([4,5]);ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(mx,0);ctx.lineTo(mx,H);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,my);ctx.lineTo(W,my);ctx.stroke();
    ctx.setLineDash([]);

    // Fiyat etiketi sağda
    const pl = fmtP(price);
    ctx.font='10px ui-monospace,monospace';
    const tw=ctx.measureText(pl).width;
    ctx.fillStyle=isDark?'rgba(4,8,28,0.9)':'rgba(240,244,248,0.95)';
    ctx.fillRect(W-tw-14,my-8,tw+10,15);
    ctx.fillStyle=isDark?'rgba(255,255,255,0.7)':'rgba(0,0,0,0.7)';
    ctx.textAlign='right';
    ctx.fillText(pl,W-4,my+4);

    // Candle kapanış fiyatı
    const candle = candles[col];
    const closePrice = candle?parseFloat(candle.c):price;
    const abovePrice = price > closePrice;

    const sv = shortGrid[col]?.[row]??0;
    const lv = longGrid[col]?.[row]??0;
    let liqVol = abovePrice?(colShort[col]||0):(colLong[col]||0);
    const sideLabel = abovePrice?'Short Zone':'Long Zone';

    setTooltip({
      x: e.clientX-rect.left,
      y: e.clientY-rect.top,
      price: fmtP(closePrice),
      date: new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''),
      liqVol,
      side: sideLabel,
    });
  },[]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    overlayRef.current?.getContext('2d')?.clearRect(0,0,overlayRef.current.width,overlayRef.current.height);
  },[]);

  // ESC
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('keydown',h);
    return()=>window.removeEventListener('keydown',h);
  },[onClose]);

  // ── Styles (tema-uyumlu) ─────────────────────────────────────────────────────
  const isDark = typeof document!=='undefined'&&document.documentElement.classList.contains('dark');
  const bg     = isDark?'#07091c':'#ffffff';
  const bg2    = isDark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.03)';
  const bd     = isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.09)';
  const t1     = isDark?'rgba(255,255,255,0.88)':'rgba(0,0,0,0.85)';
  const t2     = isDark?'rgba(255,255,255,0.4)':'rgba(0,0,0,0.4)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.7)',backdropFilter:'blur(8px)'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>

      <div className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{width:960,maxWidth:'96vw',background:bg,border:`1px solid ${bd}`,boxShadow:'0 30px 80px rgba(0,0,0,0.7)'}}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3" style={{background:bg2,borderBottom:`1px solid ${bd}`}}>
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={symbol} size={22} />
            <span className="text-[15px] font-bold" style={{color:t1}}>LiquidationHeatmap</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{background:'rgba(0,180,216,0.15)',color:'#00d4ff'}}>
              {coin}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Source badges */}
            {Object.entries(stats.sources).map(([src, s]) => {
              const ss = s as LiqSummary;
              if (!ss||ss.total<1) return null;
              const color = SOURCE_COLORS[src]||'#888';
              return (
                <div key={src} className="flex flex-col items-center px-2 py-1 rounded-lg text-[9px]"
                  style={{background:`${color}15`,border:`1px solid ${color}30`}}>
                  <span className="font-bold capitalize" style={{color}}>{src==='hyperliquid'?'HyperLiq':src}</span>
                  <span style={{color:'rgba(255,255,255,0.5)'}}>
                    <span style={{color:'#4ade80'}}>{fmtU(ss.long)}</span>
                    {' / '}
                    <span style={{color:'#f87171'}}>{fmtU(ss.short)}</span>
                  </span>
                </div>
              );
            })}

            {/* Long/Short totals */}
            {(stats.longLiq>0||stats.shortLiq>0) && (
              <div className="flex gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded font-semibold"
                  style={{background:'rgba(248,113,113,0.12)',color:'#f87171',border:'1px solid rgba(248,113,113,0.2)'}}>
                  Liq Longs: {fmtU(stats.longLiq)}
                </span>
                <span className="px-2 py-0.5 rounded font-semibold"
                  style={{background:'rgba(74,222,128,0.12)',color:'#4ade80',border:'1px solid rgba(74,222,128,0.2)'}}>
                  Liq Shorts: {fmtU(stats.shortLiq)}
                </span>
              </div>
            )}
            {stats.price>0 && (
              <span className="font-mono text-[13px] font-bold px-2.5 py-1 rounded-lg"
                style={{background:'rgba(0,180,216,0.1)',color:'#00d4ff',border:'1px solid rgba(0,180,216,0.2)'}}>
                {fmtP(stats.price)}
              </span>
            )}
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[16px] hover:opacity-60 transition-opacity"
              style={{color:t2,background:'rgba(255,255,255,0.06)'}}>✕</button>
          </div>
        </div>

        {/* ── Controls ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-5 px-5 py-2" style={{borderBottom:`1px solid ${bd}`,background:bg2}}>
          {/* Range */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold tracking-wider" style={{color:t2}}>Range</span>
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${bd}`}}>
              {RANGES.map((r,i)=>(
                <button key={r.label} onClick={()=>setRangeIdx(i)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background: rangeIdx===i?'rgba(0,180,216,0.2)':'transparent',
                    color:      rangeIdx===i?'#00d4ff':t2,
                    boxShadow:  rangeIdx===i?'0 0 0 1px rgba(0,180,216,0.3)':'none',
                  }}>{r.label}</button>
              ))}
            </div>
          </div>

          <div style={{width:1,height:14,background:bd}}/>

          {/* Side */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold tracking-wider" style={{color:t2}}>Side</span>
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${bd}`}}>
              {(['all','long','short'] as Side[]).map(s=>(
                <button key={s} onClick={()=>setSide(s)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all capitalize"
                  style={{
                    background: side===s?(s==='long'?'rgba(74,222,128,0.18)':s==='short'?'rgba(248,113,113,0.18)':'rgba(0,180,216,0.15)'):'transparent',
                    color: side===s?(s==='long'?'#4ade80':s==='short'?'#f87171':'#00d4ff'):t2,
                    boxShadow: side===s?(s==='long'?'0 0 0 1px rgba(74,222,128,0.3)':s==='short'?'0 0 0 1px rgba(248,113,113,0.3)':'0 0 0 1px rgba(0,180,216,0.3)'):'none',
                  }}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-semibold" style={{color:'#f87171'}}>SHORT</span>
              {[0.08,0.3,0.6,0.9].map((v,i)=>(
                <div key={i} className="w-5 h-2.5 rounded-sm" style={{background:shortColor(v)}}/>
              ))}
            </div>
            <div style={{width:1,height:12,background:bd}}/>
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-semibold" style={{color:'#4ade80'}}>LONG</span>
              {[0.08,0.3,0.6,0.9].map((v,i)=>(
                <div key={i} className="w-5 h-2.5 rounded-sm" style={{background:longColor(v)}}/>
              ))}
            </div>
            <div style={{width:1,height:12,background:bd}}/>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5" style={{background:'#ff3344'}}/>
              <span className="text-[9px] font-semibold" style={{color:'#ff3344'}}>Price</span>
            </div>
          </div>
        </div>

        {/* ── Canvas ─────────────────────────────────────────────────────── */}
        <div className="relative" style={{height:420}}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{background:bg}}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mb-3"
                style={{borderColor:'rgba(255,255,255,0.08)',borderTopColor:'#00d4ff'}}/>
              <span className="text-[12px]" style={{color:t2}}>Loading {coin} data...</span>
            </div>
          )}
          {error&&!loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="text-3xl">⚠️</span>
              <span className="text-[12px]" style={{color:'#f87171'}}>{error}</span>
              <button onClick={()=>setRangeIdx(r=>r)} className="text-[11px] px-3 py-1 rounded-lg mt-1"
                style={{background:'rgba(0,180,216,0.1)',color:'#00d4ff',border:'1px solid rgba(0,180,216,0.2)'}}>
                Retry
              </button>
            </div>
          )}
          <canvas ref={mainRef}    width={960} height={420} className="absolute inset-0 w-full h-full"/>
          <canvas ref={overlayRef} width={960} height={420} className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}/>

          {/* Tooltip */}
          {tooltip && (
            <div className="absolute pointer-events-none rounded-xl px-3 py-2 text-[11px] z-20"
              style={{
                left: Math.min(tooltip.x+16, 680),
                top:  Math.max(tooltip.y-10, 4),
                background: isDark?'rgba(4,8,28,0.96)':'rgba(255,255,255,0.97)',
                border: `1px solid ${bd}`,
                color: t1,
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                minWidth: 165,
              }}>
              <div className="font-mono text-[9px] mb-1.5" style={{color:t2}}>{tooltip.date}</div>
              <div className="mb-0.5">Price: <span className="font-mono font-bold">{tooltip.price}</span></div>
              {tooltip.liqVol>0&&<div>Liq Vol: <span className="font-bold">{fmtU(tooltip.liqVol)}</span></div>}
              <div style={{color:tooltip.side==='Short Zone'?'#f87171':'#4ade80'}} className="mt-0.5 font-semibold">
                {tooltip.side}
              </div>
            </div>
          )}
        </div>

        {/* ── X-axis ─────────────────────────────────────────────────────── */}
        <div className="flex justify-between px-3 py-1.5" style={{borderTop:`1px solid ${bd}`,background:bg2}}>
          {Array.from({length:8},(_,i)=>{
            const {minT,maxT}=metaRef.current;
            const ts=minT&&maxT?minT+(i/7)*(maxT-minT):0;
            return (
              <span key={i} className="text-[9px] font-mono" style={{color:t2}}>
                {ts?new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''):'—'}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
