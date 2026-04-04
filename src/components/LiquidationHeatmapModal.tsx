'use client';
/**
 * LiquidationHeatmapModal — Coinglass-style Liquidation Leverage Heatmap
 * - Yatay çizgiler: her liq seviyesi ince bir line, genişliği notional ile orantılı
 * - Koyu arka plan
 * - Line chart (candle değil)
 * - Hover: OHLC tooltip
 * - Sağ panel: kümülatif bar
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface LiqLevel { price: number; longLiq: number; shortLiq: number; }
interface Props { symbol: string; onClose: () => void; }

// Coinglass renk: koyu mavi → mavi → teal → sarı-yeşil
function liqColor(v: number): string {
  if (v <= 0) return 'transparent';
  const stops: [number,string][] = [
    [0,    'rgba(20,20,80,0)'],
    [0.05, 'rgba(30,60,180,0.5)'],
    [0.20, 'rgba(40,120,220,0.75)'],
    [0.40, 'rgba(0,180,200,0.85)'],
    [0.65, 'rgba(0,210,160,0.9)'],
    [0.85, 'rgba(180,230,40,0.95)'],
    [1,    'rgba(255,240,0,1)'],
  ];
  // Linear interpolate
  let lo = stops[0], hi = stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++) if(v>=stops[i][0]&&v<=stops[i+1][0]){lo=stops[i];hi=stops[i+1];break;}
  const t = lo[0]===hi[0]?0:(v-lo[0])/(hi[0]-lo[0]);
  // Parse rgba
  const parse = (s: string) => s.match(/[\d.]+/g)!.map(Number);
  const [lr,lg,lb,la]=parse(lo[1]);
  const [hr,hg,hb,ha]=parse(hi[1]);
  const l=(a:number,b:number)=>Math.round(a+(b-a)*t);
  const la2=la+(ha-la)*t;
  return `rgba(${l(lr,hr)},${l(lg,hg)},${l(lb,hb)},${la2.toFixed(2)})`;
}

const fmtP = (p:number) => p>=10000?'$'+p.toLocaleString('en-US',{maximumFractionDigits:0}):p>=1?'$'+p.toFixed(2):'$'+p.toPrecision(4);
const fmtU = (v:number) => v>=1e9?`$${(v/1e9).toFixed(2)}B`:v>=1e6?`$${(v/1e6).toFixed(2)}M`:v>=1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`;

const RANGES = [
  {label:'12h',hours:12, interval:'15m'},
  {label:'24h',hours:24, interval:'1h'},
  {label:'48h',hours:48, interval:'1h'},
  {label:'7d', hours:168,interval:'4h'},
];
const RIGHT_W = 80;

async function fetchCandles(symbol:string, interval:string, hours:number): Promise<Candle[]> {
  const end=Date.now(), start=end-hours*3600000;
  try {
    const path=encodeURIComponent(`kline?symbol=${symbol}&interval=${interval}&start_time=${start}&end_time=${end}`);
    const res=await fetch(`/api/proxy?path=${path}`,{signal:AbortSignal.timeout(8000)});
    const json=await res.json();
    if(json?.success&&Array.isArray(json.data)&&json.data.length>0) return json.data;
  } catch { /* fallback */ }
  const coin=symbol.replace(/-USD$/i,'');
  try {
    const res=await fetch('https://api.hyperliquid.xyz/info',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'candleSnapshot',req:{coin,interval,startTime:start,endTime:end}}),
      signal:AbortSignal.timeout(8000),
    });
    if(res.ok){
      const data=await res.json();
      if(Array.isArray(data)&&data.length>0)
        return data.map((c:Record<string,unknown>)=>({t:Number(c.t??c.T),o:String(c.o),h:String(c.h),l:String(c.l),c:String(c.c),v:String(c.v??'0')}));
    }
  } catch { /* ignore */ }
  return [];
}

export default function LiquidationHeatmapModal({symbol,onClose}:Props) {
  const mainRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState('');
  const [stats,    setStats   ] = useState({price:0,totalLong:0,totalShort:0});
  const [tooltip,  setTooltip ] = useState<{x:number;y:number;price:string;o:string;h:string;l:string;c:string;liqTotal:number}|null>(null);

  const coin = symbol.replace(/-USD$/i,'').replace(/-PERP$/i,'');

  const metaRef = useRef({
    minP:0,maxP:0,minT:0,maxT:0,W:0,H:0,COLS:0,cellW:0,
    liqLevels:[] as LiqLevel[],
    cumByRow:[] as number[],   // sağ panel için
    maxLiq:1,
    markPrice:0,
    candles:[] as Candle[],
  });

  const draw = useCallback((candles:Candle[], liqLevels:LiqLevel[], markPrice:number) => {
    const canvas=mainRef.current;
    if(!canvas||!candles.length) return;
    const ctx=canvas.getContext('2d');
    if(!ctx) return;

    const CW=canvas.width, CH=canvas.height;
    const W=CW-RIGHT_W, H=CH;

    // Fiyat aralığı — sadece candle range + %15 pad
    const allH=candles.map(c=>parseFloat(c.h));
    const allL=candles.map(c=>parseFloat(c.l));
    const cMax=Math.max(...allH);
    const cMin=Math.min(...allL);
    const center=markPrice||(cMax+cMin)/2;
    const spread=Math.max(cMax-cMin, center*0.08)*1.5;
    let maxP=center+spread, minP=Math.max(0,center-spread);
    if(maxP<=minP) return;

    const times=candles.map(c=>c.t>1e12?c.t:c.t*1000);
    const minT=Math.min(...times), maxT=Math.max(...times);
    const COLS=candles.length;
    const cellW=W/COLS;

    // Liq seviyeleri — sadece görünür fiyat aralığındakileri al
    const visibleLevels=liqLevels.filter(lv=>lv.price>minP&&lv.price<maxP&&(lv.longLiq+lv.shortLiq)>0);

    // Max liq değeri (P90)
    const vals=visibleLevels.map(lv=>lv.longLiq+lv.shortLiq).sort((a,b)=>a-b);
    const maxLiq=vals.length>0?vals[Math.floor(vals.length*0.90)]:1;

    // Kümülatif sağ panel
    const ROWS=500;
    const cumByRow=new Array(ROWS).fill(0);
    for(const lv of visibleLevels){
      const ri=Math.round((lv.price-minP)/(maxP-minP)*(ROWS-1));
      if(ri>=0&&ri<ROWS) cumByRow[ri]+=(lv.longLiq+lv.shortLiq);
    }
    const maxCum=Math.max(...cumByRow,1);

    metaRef.current={minP,maxP,minT,maxT,W,H,COLS,cellW,liqLevels:visibleLevels,cumByRow,maxLiq,markPrice,candles};

    // ── BG: koyu, neredeyse siyah ──
    ctx.fillStyle='#06080f';
    ctx.fillRect(0,0,CW,H);

    // ── Subtle grid lines ──
    ctx.strokeStyle='rgba(255,255,255,0.04)';
    ctx.lineWidth=1;
    for(let i=1;i<8;i++){
      const y=i/8*H;
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
    }

    const toY=(px:number)=>H-((px-minP)/(maxP-minP))*H;

    // ── Liq seviyeleri — yatay çizgiler ──
    // Her seviye ince bir line, uzunluğu sabit (tam width), opaklık/renk notional ile
    for(const lv of visibleLevels){
      const total=lv.longLiq+lv.shortLiq;
      if(total<=0) continue;
      const norm=Math.min(Math.pow(total/maxLiq,0.45),1);
      if(norm<0.05) continue;

      const y=toY(lv.price);
      if(y<0||y>H) continue;

      // Çizgi kalınlığı: 1-4px, notional ile orantılı
      const lineH=Math.max(1, Math.min(4, norm*4));
      // Uzunluk: yüksek yoğunlukta tam width, düşükte kısmi
      const lineW=W*0.3+W*0.7*norm;

      ctx.fillStyle=liqColor(norm);
      ctx.fillRect(W-lineW, y-lineH/2, lineW, lineH);
    }

    // ── Line chart (candle kapanış fiyatları) ──
    ctx.beginPath();
    ctx.strokeStyle='rgba(255,255,255,0.85)';
    ctx.lineWidth=1.2;
    ctx.shadowColor='rgba(255,255,255,0.3)';
    ctx.shadowBlur=2;
    let started=false;
    for(let ci=0;ci<candles.length;ci++){
      const px=parseFloat(candles[ci].c);
      const x=(ci+0.5)*cellW;
      const y=toY(px);
      if(!started){ctx.moveTo(x,y);started=true;}
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.shadowBlur=0;

    // ── Mark price dashed line ──
    if(markPrice>0){
      const y=toY(markPrice);
      ctx.setLineDash([6,5]);
      ctx.strokeStyle='#FFD700';
      ctx.lineWidth=1.2;
      ctx.shadowColor='rgba(255,215,0,0.4)';
      ctx.shadowBlur=3;
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
      ctx.setLineDash([]);ctx.shadowBlur=0;
      // Fiyat badge
      const lbl=fmtP(markPrice);
      ctx.font='bold 10px ui-monospace,monospace';
      const tw=ctx.measureText(lbl).width;
      ctx.fillStyle='#FFD700';
      ctx.fillRect(W-tw-16,y-9,tw+12,17);
      ctx.fillStyle='#000';
      ctx.textAlign='right';
      ctx.fillText(lbl,W-4,y+4);
    }

    // ── Y-axis fiyat etiketleri ──
    ctx.font='9px ui-monospace,monospace';
    ctx.textAlign='right';
    for(let i=0;i<=8;i++){
      const pct=i/8;
      const price=minP+pct*(maxP-minP);
      const y=H-pct*H;
      const lbl=fmtP(price);
      ctx.fillStyle='rgba(255,255,255,0.35)';
      ctx.fillText(lbl,W-4,y+4);
    }

    // ── Sağ panel ──
    const rx=W+1, rw=RIGHT_W-2;
    ctx.fillStyle='rgba(0,0,0,0.5)';
    ctx.fillRect(rx,0,rw,H);

    for(let ri=0;ri<ROWS;ri++){
      const v=cumByRow[ri];
      if(v<=0) continue;
      const norm=Math.min(Math.pow(v/maxCum,0.5),1);
      if(norm<0.05) continue;
      const y=H-(ri/(ROWS-1))*H;
      const bw=(v/maxCum)*rw*0.9;
      ctx.fillStyle=liqColor(norm);
      ctx.fillRect(rx,y-1,bw,2);
    }
    ctx.strokeStyle='rgba(255,255,255,0.06)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(rx,0);ctx.lineTo(rx,H);ctx.stroke();

    setStats({
      price:markPrice||parseFloat(candles[candles.length-1]?.c||'0'),
      totalLong:liqLevels.reduce((s,lv)=>s+lv.longLiq,0),
      totalShort:liqLevels.reduce((s,lv)=>s+lv.shortLiq,0),
    });
    setLoading(false);
  },[]);

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');
    const range=RANGES[rangeIdx];
    Promise.all([
      fetchCandles(symbol,range.interval,range.hours),
      fetch(`/api/liq-leverage?symbol=${encodeURIComponent(symbol)}&hours=${range.hours}`)
        .then(r=>r.ok?r.json():{levels:[],markPrice:0}).catch(()=>({levels:[],markPrice:0})),
    ]).then(([candles,liqData])=>{
      if(cancelled) return;
      if(!candles.length){setError('Kline verisi yüklenemedi');setLoading(false);return;}
      draw(candles,liqData.levels??[],liqData.markPrice??0);
    }).catch(err=>{if(!cancelled){setError(String(err));setLoading(false);}});
    return()=>{cancelled=true;};
  },[symbol,rangeIdx,draw]);

  // Crosshair + OHLC tooltip
  const onMouseMove=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const oc=overlayRef.current;
    if(!oc) return;
    const rect=oc.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(oc.width/rect.width);
    const my=(e.clientY-rect.top) *(oc.height/rect.height);
    const {minP,maxP,minT,maxT,W,H,COLS,cellW,liqLevels,cumByRow,maxLiq,candles}=metaRef.current;
    if(!COLS||!W) return;

    const ctx=oc.getContext('2d');
    if(!ctx) return;
    ctx.clearRect(0,0,oc.width,oc.height);

    // Crosshair
    ctx.strokeStyle='rgba(255,255,255,0.25)';
    ctx.setLineDash([4,5]);ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(Math.min(mx,W),0);ctx.lineTo(Math.min(mx,W),H);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,my);ctx.lineTo(oc.width,my);ctx.stroke();
    ctx.setLineDash([]);

    const price=minP+(1-my/H)*(maxP-minP);
    const ts=minT+(mx/W)*(maxT-minT);
    const col=Math.min(Math.max(Math.floor(mx/cellW),0),COLS-1);
    const candle=candles[col];

    // Nearest liq level
    let nearestLiq=0;
    for(const lv of liqLevels){
      if(Math.abs(lv.price-price)<(maxP-minP)*0.005)
        nearestLiq+=lv.longLiq+lv.shortLiq;
    }

    // Fiyat etiketi
    const pl=fmtP(price);
    ctx.font='10px ui-monospace,monospace';
    ctx.textAlign='right';
    const tw=ctx.measureText(pl).width;
    ctx.fillStyle='rgba(4,8,20,0.9)';
    ctx.fillRect(W-tw-14,my-8,tw+10,15);
    ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.fillText(pl,W-4,my+4);

    // Zaman etiketi
    const dl=new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',','');
    ctx.textAlign='center';
    ctx.font='9px ui-monospace,monospace';
    ctx.fillStyle='rgba(4,8,20,0.9)';
    const tw2=ctx.measureText(dl).width;
    ctx.fillRect(Math.min(mx,W)-tw2/2-4,H-16,tw2+8,14);
    ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.fillText(dl,Math.min(mx,W),H-5);

    if(candle){
      setTooltip({
        x:e.clientX-rect.left, y:e.clientY-rect.top,
        price:fmtP(price),
        o:parseFloat(candle.o).toFixed(1),
        h:parseFloat(candle.h).toFixed(1),
        l:parseFloat(candle.l).toFixed(1),
        c:parseFloat(candle.c).toFixed(1),
        liqTotal:nearestLiq,
      });
    }
  },[]);

  const onMouseLeave=useCallback(()=>{
    setTooltip(null);
    overlayRef.current?.getContext('2d')?.clearRect(0,0,9999,9999);
  },[]);

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);
  },[onClose]);

  const bg ='#06080f';
  const bd ='rgba(255,255,255,0.08)';
  const t1 ='rgba(255,255,255,0.88)';
  const t2 ='rgba(255,255,255,0.4)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.8)',backdropFilter:'blur(8px)'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>

      <div className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{width:1020,maxWidth:'96vw',background:bg,border:`1px solid ${bd}`,boxShadow:'0 30px 80px rgba(0,0,0,0.8)'}}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{borderBottom:`1px solid ${bd}`,background:'rgba(255,255,255,0.02)'}}>
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={symbol} size={22}/>
            <span className="text-[15px] font-bold" style={{color:t1}}>Liquidation Leverage Map</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{background:'rgba(0,210,200,0.15)',color:'#00d4c8'}}>{coin}</span>
          </div>
          <div className="flex items-center gap-3">
            {stats.price>0&&(
              <span className="font-mono text-[13px] font-bold px-2.5 py-1 rounded-lg"
                style={{background:'rgba(255,215,0,0.12)',color:'#FFD700',border:'1px solid rgba(255,215,0,0.25)'}}>
                {fmtP(stats.price)}
              </span>
            )}
            {stats.totalLong>0&&(
              <span className="text-[11px] px-2 py-0.5 rounded font-semibold"
                style={{background:'rgba(0,210,200,0.1)',color:'#00d4c8',border:'1px solid rgba(0,210,200,0.2)'}}>
                Long: {fmtU(stats.totalLong)}
              </span>
            )}
            {stats.totalShort>0&&(
              <span className="text-[11px] px-2 py-0.5 rounded font-semibold"
                style={{background:'rgba(255,80,80,0.1)',color:'#ff6060',border:'1px solid rgba(255,80,80,0.2)'}}>
                Short: {fmtU(stats.totalShort)}
              </span>
            )}
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[16px] hover:opacity-60 transition-opacity"
              style={{color:t2,background:'rgba(255,255,255,0.06)'}}>✕</button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-5 px-5 py-2" style={{borderBottom:`1px solid ${bd}`,background:'rgba(255,255,255,0.015)'}}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold tracking-wider" style={{color:t2}}>Range</span>
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${bd}`}}>
              {RANGES.map((r,i)=>(
                <button key={r.label} onClick={()=>setRangeIdx(i)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background:rangeIdx===i?'rgba(0,210,200,0.2)':'transparent',
                    color:rangeIdx===i?'#00d4c8':t2,
                    boxShadow:rangeIdx===i?'0 0 0 1px rgba(0,210,200,0.3)':'none',
                  }}>{r.label}</button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px]" style={{color:t2}}>Low</span>
              {[0.08,0.25,0.45,0.65,0.85,1].map((v,i)=>(
                <div key={i} style={{width:20,height:8,borderRadius:2,background:liqColor(v)}}/>
              ))}
              <span className="text-[9px] font-semibold" style={{color:'#FFD700'}}>High Liq</span>
            </div>
            <div style={{width:1,height:12,background:bd}}/>
            <div className="flex items-center gap-1.5">
              <div style={{width:20,height:1.5,background:'#FFD700',opacity:0.8}}/>
              <span className="text-[9px]" style={{color:'#FFD700'}}>Mark Price</span>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative" style={{height:440}}>
          {loading&&(
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{background:bg}}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mb-3"
                style={{borderColor:'rgba(0,210,200,0.15)',borderTopColor:'#00d4c8'}}/>
              <span className="text-[12px]" style={{color:t2}}>Loading {coin} leverage map...</span>
            </div>
          )}
          {error&&!loading&&(
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <span className="text-3xl">⚠️</span>
              <span className="text-[12px] text-center px-8" style={{color:'#f87171'}}>{error}</span>
              <button onClick={()=>setRangeIdx(i=>i)}
                className="text-[11px] px-4 py-1.5 rounded-lg"
                style={{background:'rgba(0,210,200,0.1)',color:'#00d4c8',border:'1px solid rgba(0,210,200,0.25)'}}>
                Retry
              </button>
            </div>
          )}
          <canvas ref={mainRef}    width={1020} height={440} className="absolute inset-0 w-full h-full"/>
          <canvas ref={overlayRef} width={1020} height={440} className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}/>

          {tooltip&&(
            <div className="absolute pointer-events-none rounded-xl z-20"
              style={{
                left:Math.min(tooltip.x+18,680),
                top:Math.max(tooltip.y-10,4),
                background:'rgba(8,12,28,0.96)',
                border:`1px solid ${bd}`,
                padding:'10px 14px',
                minWidth:180,
                boxShadow:'0 8px 30px rgba(0,0,0,0.6)',
              }}>
              <div className="font-mono text-[9px] mb-2" style={{color:t2}}>{tooltip.price} area</div>
              <div className="space-y-0.5 text-[11px]">
                {[['Open',tooltip.o],['High',tooltip.h],['Low',tooltip.l],['Close',tooltip.c]].map(([k,v])=>(
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:'rgba(255,255,255,0.4)'}}/>
                    <span style={{color:t2}}>{k}</span>
                    <span className="ml-auto font-mono font-semibold" style={{color:t1}}>{v}</span>
                  </div>
                ))}
                {tooltip.liqTotal>0&&(
                  <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t" style={{borderColor:bd}}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:'#00d4c8'}}/>
                    <span style={{color:t2}}>Liq Leverage</span>
                    <span className="ml-auto font-mono font-bold" style={{color:'#00d4c8'}}>{fmtU(tooltip.liqTotal)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* X-axis */}
        <div className="flex justify-between px-3 py-1.5" style={{borderTop:`1px solid ${bd}`,background:'rgba(255,255,255,0.015)'}}>
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
