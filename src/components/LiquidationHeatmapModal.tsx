'use client';
/**
 * LiquidationHeatmapModal — Coinglass-style liquidation heatmap
 * Kline: önce Pacifica, başarısız olursa Hyperliquid
 * Liq data: /api/liquidations/recent (4 kaynak)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface LiqEntry { symbol: string; side: string; notional: number; price: number; ts: string; source: string; }
interface LiqSrc   { long: number; short: number; total: number; count: number; }
interface Props     { symbol: string; onClose: () => void; }

// Color scales
function shortColor(v: number): string {
  if (v <= 0) return 'transparent';
  const s: [number,number,number,number,number][] = [
    [0,.060,0,0,.10],[.15,130,10,0,.35],[.35,200,50,0,.58],
    [.55,240,120,0,.72],[.75,255,200,0,.85],[.9,255,230,80,.93],[1,255,255,200,1],
  ];
  let lo=s[0],hi=s[s.length-1];
  for(let i=0;i<s.length-1;i++) if(v>=s[i][0]&&v<=s[i+1][0]){lo=s[i];hi=s[i+1];break;}
  const t=lo[0]===hi[0]?0:(v-lo[0])/(hi[0]-lo[0]);
  const l=(a:number,b:number)=>Math.round(a+(b-a)*t);
  return `rgba(${l(lo[1],hi[1])},${l(lo[2],hi[2])},${l(lo[3],hi[3])},${(lo[4]+(hi[4]-lo[4])*t).toFixed(2)})`;
}
function longColor(v: number): string {
  if (v <= 0) return 'transparent';
  const s: [number,number,number,number,number][] = [
    [0,0,30,50,.10],[.15,0,80,100,.35],[.35,0,170,160,.58],
    [.55,0,210,90,.72],[.75,80,230,40,.85],[.9,180,240,30,.93],[1,220,255,100,1],
  ];
  let lo=s[0],hi=s[s.length-1];
  for(let i=0;i<s.length-1;i++) if(v>=s[i][0]&&v<=s[i+1][0]){lo=s[i];hi=s[i+1];break;}
  const t=lo[0]===hi[0]?0:(v-lo[0])/(hi[0]-lo[0]);
  const l=(a:number,b:number)=>Math.round(a+(b-a)*t);
  return `rgba(${l(lo[1],hi[1])},${l(lo[2],hi[2])},${l(lo[3],hi[3])},${(lo[4]+(hi[4]-lo[4])*t).toFixed(2)})`;
}

const fmtP = (p:number) => p>=10000?'$'+p.toLocaleString('en-US',{maximumFractionDigits:0}):p>=1?'$'+p.toFixed(2):'$'+p.toPrecision(4);
const fmtU = (v:number) => v>=1e9?`$${(v/1e9).toFixed(2)}B`:v>=1e6?`$${(v/1e6).toFixed(2)}M`:v>=1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`;

const RANGES = [
  {label:'12h',hours:12, interval:'15m'},
  {label:'24h',hours:24, interval:'1h' },
  {label:'48h',hours:48, interval:'1h' },
  {label:'7d', hours:168,interval:'4h' },
];
type Side = 'all'|'long'|'short';
const ROWS    = 120;
const RIGHT_W = 72;

const SRC_COLORS: Record<string,string> = {
  pacifica:'#00d4ff', binance:'#F0B90B', hyperliquid:'#00E5CF', bybit:'#F7A600',
};
const SRC_LABEL: Record<string,string> = {
  pacifica:'Pacifica', binance:'Binance', hyperliquid:'HyperLiq', bybit:'OKX', okx:'OKX',
};

// Kline fetch — önce Pacifica, sonra Hyperliquid fallback
async function fetchCandles(symbol: string, interval: string, hours: number): Promise<Candle[]> {
  const coin = symbol.replace(/-USD$/i,'').replace(/-PERP$/i,'');
  const end   = Date.now();
  const start = end - hours * 3600 * 1000;

  // 1. Pacifica kline
  try {
    const path = encodeURIComponent(`kline?symbol=${symbol}&interval=${interval}&start_time=${start}&end_time=${end}`);
    const res  = await fetch(`/api/proxy?path=${path}`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
      return json.data as Candle[];
    }
  } catch { /* fallback */ }

  // 2. Hyperliquid kline fallback
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        type:'candleSnapshot',
        req:{ coin, interval, startTime: start, endTime: end }
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // Hyperliquid format: {t, T, s, i, o, c, h, l, v, n}
        return data.map((c: Record<string,unknown>) => ({
          t: Number(c.t ?? c.T),
          o: String(c.o),
          h: String(c.h),
          l: String(c.l),
          c: String(c.c),
          v: String(c.v ?? '0'),
        }));
      }
    }
  } catch { /* ignore */ }

  return [];
}

export default function LiquidationHeatmapModal({ symbol, onClose }: Props) {
  const mainRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const [rangeIdx, setRangeIdx] = useState(1);
  const [side,     setSide    ] = useState<Side>('all');
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState('');
  const [stats,    setStats   ] = useState({price:0, longLiq:0, shortLiq:0, sources:{} as Record<string,LiqSrc>});
  const [tooltip,  setTooltip ] = useState<{x:number;y:number;price:string;date:string;liqVol:number;sideLabel:string}|null>(null);

  const coin = symbol.replace(/-USD$/i,'').replace(/-PERP$/i,'');

  const metaRef = useRef({
    minP:0,maxP:0,minT:0,maxT:0,COLS:0,cellW:0,cellH:0,W:0,H:0,
    shortGrid:[] as number[][],longGrid:[] as number[][],
    colShort:[] as number[],colLong:[] as number[],
    priceShort:new Array(ROWS).fill(0),priceLong:new Array(ROWS).fill(0),
    candles:[] as Candle[],
  });

  // ── Canvas render ────────────────────────────────────────────────────────────
  const draw = useCallback((candles: Candle[], liqs: LiqEntry[], sideMode: Side) => {
    const canvas = mainRef.current;
    if (!canvas || !candles.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dark = document.documentElement.classList.contains('dark');
    const CW   = canvas.width;
    const CH   = canvas.height;
    const W    = CW - RIGHT_W;
    const H    = CH;

    // Fiyat aralığı
    let maxP = Math.max(...candles.map(c=>parseFloat(c.h)));
    let minP = Math.min(...candles.map(c=>parseFloat(c.l)));
    const pad = (maxP-minP)*0.08;
    maxP += pad; minP -= pad;
    if (maxP <= minP) return;

    // Zaman aralığı
    const times = candles.map(c=>c.t>1e12?c.t:c.t*1000);
    const minT  = Math.min(...times);
    const maxT  = Math.max(...times);
    const COLS  = candles.length;
    const cellW = W/COLS;
    const cellH = H/ROWS;

    // Grid
    const shortGrid  = Array.from({length:COLS},()=>new Array(ROWS).fill(0));
    const longGrid   = Array.from({length:COLS},()=>new Array(ROWS).fill(0));
    const colShort   = new Array(COLS).fill(0);
    const colLong    = new Array(COLS).fill(0);
    const priceShort = new Array(ROWS).fill(0);
    const priceLong  = new Array(ROWS).fill(0);
    let totalLong=0, totalShort=0;

    const addLiq = (isLong: boolean, ci: number, price: number, notional: number) => {
      const grid   = isLong ? longGrid  : shortGrid;
      const colArr = isLong ? colLong   : colShort;
      const prArr  = isLong ? priceLong : priceShort;
      if (ci<0||ci>=COLS) return;
      const rf = (price-minP)/(maxP-minP);
      if (rf<0||rf>1) return;
      const row = ROWS-1-Math.floor(rf*ROWS);
      const spread = Math.max(1,Math.floor(ROWS*0.02));
      for (let dr=-spread;dr<=spread;dr++) {
        const r=row+dr;
        if(r<0||r>=ROWS) continue;
        const w=1-Math.abs(dr)/(spread+1);
        grid[ci][r]+=notional*w;
      }
      colArr[ci]+=notional;
      if(row>=0&&row<ROWS) prArr[row]+=notional;
    };

    // Gerçek liq eventleri
    for (const liq of liqs) {
      const ts = new Date(liq.ts).getTime();
      if (!ts||!isFinite(ts)) continue;
      const ci = Math.min(Math.max(Math.floor(((ts-minT)/(maxT-minT+1))*COLS),0),COLS-1);
      const price = liq.price>0 ? liq.price : parseFloat(candles[ci]?.c??'0');
      if (!price||!isFinite(price)) continue;
      const isLong = liq.side==='long';
      if (isLong) totalLong+=liq.notional; else totalShort+=liq.notional;
      addLiq(isLong, ci, price, liq.notional);
    }

    // Candle wick bazlı density (her zaman dolu görünmesi için)
    for (let ci=0;ci<candles.length;ci++) {
      const c = candles[ci];
      const high=parseFloat(c.h),low=parseFloat(c.l);
      const open=parseFloat(c.o),close=parseFloat(c.c);
      const vol =parseFloat(c.v)||1;
      const body =Math.abs(close-open)||0.001;
      const upper=high-Math.max(open,close);
      const lower=Math.min(open,close)-low;
      const scale=vol*0.0002;
      if(upper>body*0.15) addLiq(false,ci,high-upper*0.25,upper*scale);
      if(lower>body*0.15) addLiq(true, ci,low +lower*0.25,lower*scale);
    }

    // Normalize
    let maxS=1e-9,maxL=1e-9;
    for(let ci=0;ci<COLS;ci++) for(let ri=0;ri<ROWS;ri++){
      if(shortGrid[ci][ri]>maxS) maxS=shortGrid[ci][ri];
      if(longGrid[ci][ri] >maxL) maxL=longGrid[ci][ri];
    }
    const nS=(v:number)=>Math.pow(v/maxS,0.42);
    const nL=(v:number)=>Math.pow(v/maxL,0.42);

    // Save meta
    metaRef.current={minP,maxP,minT,maxT,COLS,cellW,cellH,W,H,
      shortGrid,longGrid,colShort,colLong,priceShort,priceLong,candles};

    // ── BG ──
    ctx.fillStyle = dark?'#060a1a':'#f0f4f8';
    ctx.fillRect(0,0,CW,H);

    // ── Heatmap ──
    for(let ci=0;ci<COLS;ci++){
      const closeP=parseFloat(candles[ci]?.c||'0');
      const closeRow=ROWS-1-Math.floor(((closeP-minP)/(maxP-minP))*ROWS);
      for(let ri=0;ri<ROWS;ri++){
        const above=ri<=closeRow;
        let color='';
        if((sideMode==='all'||sideMode==='short')&&above){
          const v=nS(shortGrid[ci][ri]);
          if(v>0.04) color=shortColor(v);
        }
        if((sideMode==='all'||sideMode==='long')&&!above){
          const v=nL(longGrid[ci][ri]);
          if(v>0.04) color=longColor(v);
        }
        if(!color) continue;
        ctx.fillStyle=color;
        ctx.fillRect(Math.floor(ci*cellW),Math.floor(ri*cellH),Math.ceil(cellW)+1,Math.ceil(cellH)+1);
      }
    }

    // ── Grid lines ──
    ctx.strokeStyle=dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.05)';
    ctx.lineWidth=1;
    for(let i=1;i<8;i++){
      const y=i/8*H;
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
    }

    // ── Price line ──
    ctx.beginPath();
    ctx.strokeStyle='#ff3344';ctx.lineWidth=1.5;
    ctx.shadowColor='rgba(255,50,70,0.5)';ctx.shadowBlur=4;
    candles.forEach((c,ci)=>{
      const y=H-((parseFloat(c.c)-minP)/(maxP-minP))*H;
      const x=(ci+0.5)*cellW;
      ci===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();ctx.shadowBlur=0;

    // ── Y-axis labels ──
    ctx.font='10px ui-monospace,monospace';ctx.textAlign='right';
    const lc=dark?'rgba(255,255,255,0.6)':'rgba(0,0,0,0.6)';
    const lb=dark?'rgba(6,10,26,0.85)':'rgba(240,244,248,0.9)';
    for(let i=0;i<=7;i++){
      const p=maxP-i/7*(maxP-minP);
      const y=i/7*H;
      const lbl=fmtP(p);
      const tw=ctx.measureText(lbl).width;
      ctx.fillStyle=lb;ctx.fillRect(W-tw-14,y-8,tw+10,15);
      ctx.fillStyle=lc;ctx.fillText(lbl,W-4,y+4);
    }

    // ── Right panel: cumulative bar ──
    const rx=W+2,rw=RIGHT_W-4;
    ctx.fillStyle=dark?'rgba(0,0,0,0.45)':'rgba(200,210,230,0.5)';
    ctx.fillRect(rx,0,rw,H);
    const maxAll=Math.max(...priceShort,...priceLong,1);
    for(let ri=0;ri<ROWS;ri++){
      const y=ri*cellH;
      const sh=priceShort[ri],lo=priceLong[ri];
      if(sh>0){
        ctx.fillStyle=shortColor(Math.min(Math.pow(sh/Math.max(...priceShort,1),0.5),1));
        ctx.fillRect(rx,y,(sh/maxAll)*rw*0.95,Math.max(cellH-0.5,0.5));
      }
      if(lo>0){
        ctx.fillStyle=longColor(Math.min(Math.pow(lo/Math.max(...priceLong,1),0.5),1));
        ctx.fillRect(rx,y,(lo/maxAll)*rw*0.95,Math.max(cellH-0.5,0.5));
      }
    }
    ctx.strokeStyle=dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.1)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(rx,0);ctx.lineTo(rx,H);ctx.stroke();

    const lastPrice=parseFloat(candles[candles.length-1]?.c||'0');
    setStats(st=>({...st, price:lastPrice, longLiq:totalLong, shortLiq:totalShort}));
    setLoading(false);
  }, []);

  // ── Fetch + render ───────────────────────────────────────────────────────────
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');
    const range=RANGES[rangeIdx];

    Promise.all([
      fetchCandles(symbol, range.interval, range.hours),
      fetch(`/api/liquidations/recent?hours=${range.hours}&symbol=${encodeURIComponent(symbol)}`)
        .then(r=>r.ok?r.json():{events:[],summary:{}}).catch(()=>({events:[],summary:{}})),
    ]).then(([candles, liqData])=>{
      if(cancelled) return;
      const liqs: LiqEntry[] = Array.isArray(liqData?.events) ? liqData.events : [];
      const summary           = liqData?.summary ?? {};
      setStats(st=>({...st, sources:summary}));

      if(!candles.length){
        setError('Kline verisi yüklenemedi — proxy veya API sorunu');
        setLoading(false);
        return;
      }
      draw(candles, liqs, side);
    }).catch(err=>{
      if(!cancelled){setError('Veri alınamadı: '+String(err));setLoading(false);}
    });
    return()=>{cancelled=true;};
  },[symbol,rangeIdx,side,draw]);

  // ── Crosshair ────────────────────────────────────────────────────────────────
  const onMouseMove=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const oc=overlayRef.current;
    if(!oc) return;
    const rect=oc.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(oc.width/rect.width);
    const my=(e.clientY-rect.top )*(oc.height/rect.height);
    const {minP,maxP,minT,maxT,COLS,cellW,cellH,W,H,shortGrid,longGrid,colShort,colLong,candles}=metaRef.current;
    if(!COLS||!W||mx>W) return;
    const dark=document.documentElement.classList.contains('dark');
    const ctx=oc.getContext('2d');
    if(!ctx) return;
    ctx.clearRect(0,0,oc.width,oc.height);
    ctx.strokeStyle=dark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.3)';
    ctx.setLineDash([4,5]);ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(mx,0);ctx.lineTo(mx,H);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,my);ctx.lineTo(W,my);ctx.stroke();
    ctx.setLineDash([]);
    const price=maxP-(my/H)*(maxP-minP);
    const pl=fmtP(price);
    ctx.font='10px ui-monospace,monospace';ctx.textAlign='right';
    const tw=ctx.measureText(pl).width;
    ctx.fillStyle=dark?'rgba(4,8,26,0.9)':'rgba(240,244,248,0.95)';
    ctx.fillRect(W-tw-14,my-8,tw+10,15);
    ctx.fillStyle=dark?'rgba(255,255,255,0.7)':'rgba(0,0,0,0.7)';
    ctx.fillText(pl,W-4,my+4);
    const ts=minT+(mx/W)*(maxT-minT);
    const col=Math.min(Math.max(Math.floor(mx/cellW),0),COLS-1);
    const candle=candles[col];
    const closeP=candle?parseFloat(candle.c):price;
    const above=price>closeP;
    const liqVol=above?(colShort[col]||0):(colLong[col]||0);
    setTooltip({
      x:e.clientX-rect.left,y:e.clientY-rect.top,
      price:fmtP(closeP),
      date:new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''),
      liqVol,
      sideLabel:above?'Short Zone':'Long Zone',
    });
  },[]);

  const onMouseLeave=useCallback(()=>{
    setTooltip(null);
    overlayRef.current?.getContext('2d')?.clearRect(0,0,9999,9999);
  },[]);

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);
  },[onClose]);

  const dark=typeof document!=='undefined'&&document.documentElement.classList.contains('dark');
  const bg  =dark?'#07091c':'#ffffff';
  const bg2 =dark?'rgba(255,255,255,0.025)':'rgba(0,0,0,0.025)';
  const bd  =dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.09)';
  const t1  =dark?'rgba(255,255,255,0.88)':'rgba(0,0,0,0.85)';
  const t2  =dark?'rgba(255,255,255,0.4)':'rgba(0,0,0,0.4)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.72)',backdropFilter:'blur(8px)'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{width:960,maxWidth:'96vw',background:bg,border:`1px solid ${bd}`,boxShadow:'0 30px 80px rgba(0,0,0,0.7)'}}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{background:bg2,borderBottom:`1px solid ${bd}`}}>
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={symbol} size={22}/>
            <span className="text-[15px] font-bold" style={{color:t1}}>LiquidationHeatmap</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{background:'rgba(0,180,216,0.15)',color:'#00d4ff'}}>{coin}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Source badges */}
            {Object.entries(stats.sources).map(([src,s])=>{
              const ss=s as LiqSrc;
              if(!ss||ss.total<1) return null;
              const color=SRC_COLORS[src]||'#888';
              return (
                <div key={src} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px]"
                  style={{background:`${color}15`,border:`1px solid ${color}30`}}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:color}}/>
                  <span className="font-bold" style={{color}}>{SRC_LABEL[src]||src}</span>
                  <span style={{color:'rgba(255,255,255,0.45)'}}>
                    <span style={{color:'#4ade80'}}>{fmtU(ss.long)}</span>
                    {'/'}
                    <span style={{color:'#f87171'}}>{fmtU(ss.short)}</span>
                  </span>
                </div>
              );
            })}
            {stats.price>0&&(
              <span className="font-mono text-[12px] font-bold px-2.5 py-1 rounded-lg"
                style={{background:'rgba(0,180,216,0.1)',color:'#00d4ff',border:'1px solid rgba(0,180,216,0.2)'}}>
                {fmtP(stats.price)}
              </span>
            )}
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-[16px] hover:opacity-60 transition-opacity"
              style={{color:t2,background:'rgba(255,255,255,0.06)'}}>✕</button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-5 px-5 py-2" style={{borderBottom:`1px solid ${bd}`,background:bg2}}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold tracking-wider" style={{color:t2}}>Range</span>
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${bd}`}}>
              {RANGES.map((r,i)=>(
                <button key={r.label} onClick={()=>setRangeIdx(i)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background:rangeIdx===i?'rgba(0,180,216,0.2)':'transparent',
                    color:rangeIdx===i?'#00d4ff':t2,
                    boxShadow:rangeIdx===i?'0 0 0 1px rgba(0,180,216,0.3)':'none',
                  }}>{r.label}</button>
              ))}
            </div>
          </div>
          <div style={{width:1,height:14,background:bd}}/>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold tracking-wider" style={{color:t2}}>Side</span>
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${bd}`}}>
              {(['all','long','short'] as Side[]).map(s=>(
                <button key={s} onClick={()=>setSide(s)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all capitalize"
                  style={{
                    background:side===s?(s==='long'?'rgba(74,222,128,0.18)':s==='short'?'rgba(248,113,113,0.18)':'rgba(0,180,216,0.15)'):'transparent',
                    color:side===s?(s==='long'?'#4ade80':s==='short'?'#f87171':'#00d4ff'):t2,
                    boxShadow:side===s?(s==='long'?'0 0 0 1px rgba(74,222,128,0.3)':s==='short'?'0 0 0 1px rgba(248,113,113,0.3)':'0 0 0 1px rgba(0,180,216,0.3)'):'none',
                  }}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-semibold" style={{color:'#f87171'}}>SHORT</span>
              {[0.08,0.3,0.6,0.9].map((v,i)=><div key={i} className="w-5 h-2.5 rounded-sm" style={{background:shortColor(v)}}/>)}
            </div>
            <div style={{width:1,height:12,background:bd}}/>
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-semibold" style={{color:'#4ade80'}}>LONG</span>
              {[0.08,0.3,0.6,0.9].map((v,i)=><div key={i} className="w-5 h-2.5 rounded-sm" style={{background:longColor(v)}}/>)}
            </div>
            <div style={{width:1,height:12,background:bd}}/>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5" style={{background:'#ff3344'}}/>
              <span className="text-[9px] font-semibold" style={{color:'#ff3344'}}>Price</span>
            </div>
          </div>
        </div>

        {/* Canvas area */}
        <div className="relative" style={{height:420}}>
          {loading&&(
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{background:bg}}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mb-3"
                style={{borderColor:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)',borderTopColor:'#00d4ff'}}/>
              <span className="text-[12px]" style={{color:t2}}>Loading {coin} data...</span>
            </div>
          )}
          {error&&!loading&&(
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <span className="text-3xl">⚠️</span>
              <span className="text-[12px] text-center px-8" style={{color:'#f87171'}}>{error}</span>
              <button onClick={()=>setRangeIdx(i=>i)}
                className="text-[11px] px-4 py-1.5 rounded-lg transition-opacity hover:opacity-70"
                style={{background:'rgba(0,180,216,0.12)',color:'#00d4ff',border:'1px solid rgba(0,180,216,0.25)'}}>
                Retry
              </button>
            </div>
          )}
          <canvas ref={mainRef}    width={960} height={420} className="absolute inset-0 w-full h-full"/>
          <canvas ref={overlayRef} width={960} height={420} className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}/>
          {tooltip&&(
            <div className="absolute pointer-events-none rounded-xl px-3 py-2 text-[11px] z-20"
              style={{
                left:Math.min(tooltip.x+16,680),top:Math.max(tooltip.y-10,4),
                background:dark?'rgba(4,8,28,0.96)':'rgba(255,255,255,0.97)',
                border:`1px solid ${bd}`,color:t1,
                boxShadow:'0 8px 30px rgba(0,0,0,0.5)',minWidth:160,
              }}>
              <div className="font-mono text-[9px] mb-1.5" style={{color:t2}}>{tooltip.date}</div>
              <div className="mb-0.5">Price: <span className="font-mono font-bold">{tooltip.price}</span></div>
              {tooltip.liqVol>0&&<div>Liq: <span className="font-bold">{fmtU(tooltip.liqVol)}</span></div>}
              <div className="mt-0.5 font-semibold text-[10px]"
                style={{color:tooltip.sideLabel==='Short Zone'?'#f87171':'#4ade80'}}>
                {tooltip.sideLabel}
              </div>
            </div>
          )}
        </div>

        {/* X-axis */}
        <div className="flex justify-between px-3 py-1.5" style={{borderTop:`1px solid ${bd}`,background:bg2}}>
          {Array.from({length:8},(_,i)=>{
            const {minT,maxT}=metaRef.current;
            const ts=minT&&maxT?minT+(i/7)*(maxT-minT):0;
            return <span key={i} className="text-[9px] font-mono" style={{color:t2}}>
              {ts?new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''):'—'}
            </span>;
          })}
        </div>
      </div>
    </div>
  );
}
