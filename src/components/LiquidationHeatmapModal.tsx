'use client';
/**
 * LiquidationHeatmapModal — TradingView tarzı temiz chart
 * Üst panel: Price line chart (fiyat hareketi)
 * Alt panel: Liq leverage bar chart (long=teal, short=kırmızı) — fiyat seviyelerine göre
 * Tema: dark/light uyumlu
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface LiqLevel { price: number; longLiq: number; shortLiq: number; }
interface Props { symbol: string; onClose: () => void; }

const fmtP = (p: number) =>
  p >= 10000 ? '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : p >= 1   ? '$' + p.toFixed(2)
  : '$' + p.toPrecision(4);
const fmtU = (v: number) =>
  v >= 1e9 ? `$${(v/1e9).toFixed(2)}B`
  : v >= 1e6 ? `$${(v/1e6).toFixed(2)}M`
  : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K`
  : `$${v.toFixed(0)}`;

const RANGES = [
  { label: '12h', hours: 12,  interval: '15m' },
  { label: '24h', hours: 24,  interval: '1h'  },
  { label: '48h', hours: 48,  interval: '1h'  },
  { label: '7d',  hours: 168, interval: '4h'  },
];

async function fetchCandles(symbol: string, interval: string, hours: number): Promise<Candle[]> {
  const end = Date.now(), start = end - hours * 3600000;
  try {
    const path = encodeURIComponent(`kline?symbol=${symbol}&interval=${interval}&start_time=${start}&end_time=${end}`);
    const res  = await fetch(`/api/proxy?path=${path}`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (json?.success && Array.isArray(json.data) && json.data.length > 0) return json.data;
  } catch { /* fallback */ }
  const coin = symbol.replace(/-USD$/i, '');
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime: start, endTime: end } }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0)
        return data.map((c: Record<string, unknown>) => ({
          t: Number(c.t ?? c.T), o: String(c.o), h: String(c.h),
          l: String(c.l), c: String(c.c), v: String(c.v ?? '0'),
        }));
    }
  } catch { /* ignore */ }
  return [];
}

export default function LiquidationHeatmapModal({ symbol, onClose }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState('');
  const [stats,    setStats   ] = useState({ price: 0, totalLong: 0, totalShort: 0 });
  const [tooltip,  setTooltip ] = useState<{
    x: number; y: number;
    date: string; o: string; h: string; l: string; c: string;
    liqLong: number; liqShort: number;
    inLiqPanel: boolean;
    panelPrice: string;
    cumLong: number; cumShort: number;
  } | null>(null);

  const coin = symbol.replace(/-USD$/i, '').replace(/-PERP$/i, '');

  const metaRef = useRef({
    candles: [] as Candle[],
    liqByPrice: [] as { price: number; long: number; short: number }[],
    minP: 0, maxP: 0, minT: 0, maxT: 0,
    W: 0, H: 0, PRICE_H: 0, LIQ_H: 0,
    COLS: 0, cellW: 0,
    markPrice: 0,
    isDark: true,
    cumLong: 0, cumShort: 0,
    buckets: [] as {long:number;short:number}[],
    bucketW: 0,
  });

  const draw = useCallback((
    candles: Candle[],
    liqLevels: LiqLevel[],
    markPrice: number,
    isDark: boolean,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || !candles.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CW = canvas.width, CH = canvas.height;
    const PRICE_H = Math.round(CH * 0.58); // üst %58 fiyat
    const LIQ_H   = CH - PRICE_H - 2;      // alt panel liq

    // Tema renkleri
    const bgMain   = isDark ? '#06080f' : '#f8fafc';
    const bgPanel  = isDark ? '#0a0d1a' : '#ffffff';
    const gridC    = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const textC    = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
    const lineC    = isDark ? 'rgba(120,160,255,0.9)'  : 'rgba(60,100,220,0.9)';
    const lineFill = isDark ? 'rgba(80,120,255,0.08)'  : 'rgba(60,100,220,0.06)';
    const divC     = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';

    // Fiyat aralığı
    const allH = candles.map(c => parseFloat(c.h));
    const allL = candles.map(c => parseFloat(c.l));
    let maxP = Math.max(...allH, markPrice);
    let minP = Math.min(...allL, markPrice);
    const pad = (maxP - minP) * 0.08;
    maxP += pad; minP = Math.max(0, minP - pad);

    const times = candles.map(c => c.t > 1e12 ? c.t : c.t * 1000);
    const minT  = Math.min(...times), maxT = Math.max(...times);
    const COLS  = candles.length;
    const cellW = CW / COLS;

    // Liq verilerini fiyat aralığında filtrele ve sırala
    const visible = liqLevels
      .filter(lv => lv.price >= minP && lv.price <= maxP)
      .sort((a, b) => a.price - b.price);

    const maxLiq = Math.max(...visible.map(lv => lv.longLiq + lv.shortLiq), 1);

    // Meta kaydet
    metaRef.current = {
      candles, liqByPrice: visible.map(lv => ({ price: lv.price, long: lv.longLiq, short: lv.shortLiq })),
      minP, maxP, minT, maxT, W: CW, H: CH, PRICE_H, LIQ_H, COLS, cellW, markPrice, isDark,
    };

    // ── BG ──
    ctx.fillStyle = bgMain;
    ctx.fillRect(0, 0, CW, CH);

    // ── Üst panel BG ──
    ctx.fillStyle = bgPanel;
    ctx.fillRect(0, 0, CW, PRICE_H);

    // ── Grid ──
    ctx.strokeStyle = gridC;
    ctx.lineWidth = 1;
    const toY = (px: number) => PRICE_H - ((px - minP) / (maxP - minP)) * PRICE_H;
    for (let i = 1; i < 6; i++) {
      const y = (i / 6) * PRICE_H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
    }
    // Vertical grid
    for (let i = 1; i < 8; i++) {
      const x = (i / 8) * CW;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PRICE_H); ctx.stroke();
    }

    // ── Price area fill ──
    const closes = candles.map(c => parseFloat(c.c));
    ctx.beginPath();
    for (let i = 0; i < closes.length; i++) {
      const x = (i + 0.5) * cellW;
      const y = toY(closes[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo((closes.length - 0.5) * cellW, PRICE_H);
    ctx.lineTo(0.5 * cellW, PRICE_H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, PRICE_H);
    grad.addColorStop(0, isDark ? 'rgba(80,120,255,0.20)' : 'rgba(60,100,220,0.15)');
    grad.addColorStop(1, isDark ? 'rgba(80,120,255,0.00)' : 'rgba(60,100,220,0.00)');
    ctx.fillStyle = grad;
    ctx.fill();

    // ── Price line ──
    ctx.beginPath();
    ctx.strokeStyle = lineC;
    ctx.lineWidth   = 1.8;
    ctx.lineJoin    = 'round';
    for (let i = 0; i < closes.length; i++) {
      const x = (i + 0.5) * cellW;
      const y = toY(closes[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Y-axis labels ──
    ctx.font = '9px ui-monospace,monospace';
    ctx.fillStyle = textC;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const pct   = i / 5;
      const price = minP + pct * (maxP - minP);
      const y     = PRICE_H - pct * PRICE_H;
      if (y < 10 || y > PRICE_H - 4) continue;
      ctx.fillText(fmtP(price), CW - 4, y + 3);
    }

    // ── Mark price line ──
    if (markPrice > 0) {
      const y = toY(markPrice);
      if (y >= 0 && y <= PRICE_H) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = isDark ? 'rgba(255,215,0,0.7)' : 'rgba(200,150,0,0.8)';
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
        ctx.setLineDash([]);
        // Badge
        const lbl = fmtP(markPrice);
        ctx.font  = 'bold 10px ui-monospace,monospace';
        const tw  = ctx.measureText(lbl).width;
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(CW - tw - 18, y - 9, tw + 14, 18);
        ctx.fillStyle = '#000';
        ctx.textAlign = 'right';
        ctx.fillText(lbl, CW - 5, y + 4);
      }
    }

    // ── Divider ──
    ctx.fillStyle = divC;
    ctx.fillRect(0, PRICE_H, CW, 2);

    // ── Alt panel: Liq leverage bar chart ──
    // X: fiyat (solda minP, sağda maxP) — fiyat ekseni yatay
    // Y: notional büyüklüğü (yukarı = büyük)
    ctx.fillStyle = bgPanel;
    ctx.fillRect(0, PRICE_H + 2, CW, LIQ_H);

    // Alt panel grid
    ctx.strokeStyle = gridC;
    ctx.lineWidth   = 1;
    for (let i = 1; i < 4; i++) {
      const y = PRICE_H + 2 + (i / 4) * LIQ_H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
    }

    // Fiyatı X koordinatına çevir
    const toX = (px: number) => ((px - minP) / (maxP - minP)) * CW;

    if (visible.length > 0) {
      // Fiyat aralığını eşit bucket'lara böl
      const BUCKETS = 120;
      const bucketW = (maxP - minP) / BUCKETS;
      const buckets: {long:number;short:number}[] = Array.from({length:BUCKETS},()=>({long:0,short:0}));

      for (const lv of visible) {
        const bi = Math.floor((lv.price - minP) / bucketW);
        if (bi >= 0 && bi < BUCKETS) {
          buckets[bi].long  += lv.longLiq;
          buckets[bi].short += lv.shortLiq;
        }
      }

      const maxBucket = Math.max(...buckets.map(b => b.long + b.short), 1);
      const barPixW   = Math.max(2, CW / BUCKETS - 1);
      const maxBarH   = LIQ_H * 0.85;
      const panelTop  = PRICE_H + 2;

      for (let bi = 0; bi < BUCKETS; bi++) {
        const b     = buckets[bi];
        const total = b.long + b.short;
        if (total < maxBucket * 0.015) continue;

        const x     = toX(minP + (bi + 0.5) * bucketW);
        const normH = Math.pow(total / maxBucket, 0.55) * maxBarH;

        // Long (teal) — altta
        const longH = total > 0 ? (b.long / total) * normH : 0;
        if (longH > 0.5) {
          ctx.fillStyle = isDark ? 'rgba(0,200,170,0.80)' : 'rgba(0,150,130,0.85)';
          ctx.fillRect(x - barPixW/2, panelTop + LIQ_H - longH, barPixW, longH);
        }

        // Short (kırmızı) — long'un üstünde
        const shortH = total > 0 ? (b.short / total) * normH : 0;
        if (shortH > 0.5) {
          ctx.fillStyle = isDark ? 'rgba(255,80,80,0.70)' : 'rgba(210,50,50,0.75)';
          ctx.fillRect(x - barPixW/2, panelTop + LIQ_H - longH - shortH, barPixW, shortH);
        }
      }

      // Kümülatif değerleri meta'ya kaydet
      const cumLong  = buckets.reduce((s,b)=>s+b.long,0);
      const cumShort = buckets.reduce((s,b)=>s+b.short,0);
      Object.assign(metaRef.current, {cumLong, cumShort, buckets, bucketW});

      // Mark price dikey
      if (markPrice > 0) {
        const x = toX(markPrice);
        ctx.strokeStyle = '#FFD700';
        ctx.setLineDash([3,4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, panelTop); ctx.lineTo(x, panelTop+LIQ_H); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Alt panel label
    ctx.font      = '9px ui-monospace,monospace';
    ctx.fillStyle = textC;
    ctx.textAlign = 'left';
    ctx.fillText('Liq Leverage', 6, PRICE_H + 13);

    // Alt panel X-axis (fiyat etiketleri)
    ctx.textAlign = 'center';
    for (let i = 0; i <= 6; i++) {
      const pct   = i / 6;
      const price = minP + pct * (maxP - minP);
      const x     = pct * CW;
      ctx.fillStyle = textC;
      ctx.fillText(fmtP(price), x, PRICE_H + 2 + LIQ_H - 3);
    }

    setStats({
      price:      markPrice || closes[closes.length - 1] || 0,
      totalLong:  liqLevels.reduce((s, lv) => s + lv.longLiq, 0),
      totalShort: liqLevels.reduce((s, lv) => s + lv.shortLiq, 0),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const range  = RANGES[rangeIdx];
    const isDark = document.documentElement.classList.contains('dark');

    Promise.all([
      fetchCandles(symbol, range.interval, range.hours),
      fetch(`/api/liq-leverage?symbol=${encodeURIComponent(symbol)}&hours=${range.hours}`)
        .then(r => r.ok ? r.json() : { levels: [], markPrice: 0 })
        .catch(() => ({ levels: [], markPrice: 0 })),
    ]).then(([candles, liqData]) => {
      if (cancelled) return;
      if (!candles.length) { setError('Veri yüklenemedi'); setLoading(false); return; }
      draw(candles, liqData.levels ?? [], liqData.markPrice ?? 0, isDark);
    }).catch(err => {
      if (!cancelled) { setError(String(err)); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [symbol, rangeIdx, draw]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const oc = overlayRef.current;
    if (!oc) return;
    const rect = oc.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (oc.width  / rect.width);
    const my   = (e.clientY - rect.top)  * (oc.height / rect.height);
    const { candles, liqByPrice, minP, maxP, minT, maxT, W, PRICE_H, LIQ_H, COLS, cellW, isDark } = metaRef.current;
    if (!COLS || !W) return;

    const ctx = oc.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, oc.width, oc.height);

    const gridC = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
    const textC = isDark ? 'rgba(255,255,255,0.7)'  : 'rgba(0,0,0,0.7)';
    const bgC   = isDark ? 'rgba(6,8,15,0.92)'      : 'rgba(248,250,252,0.95)';

    // Crosshair (sadece üst panel)
    if (my < PRICE_H) {
      ctx.strokeStyle = gridC;
      ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, PRICE_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(W, my); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Fiyat etiketi (sağ)
    const price = minP + (1 - my / PRICE_H) * (maxP - minP);
    if (my < PRICE_H && price > 0) {
      const pl = fmtP(price);
      ctx.font  = '10px ui-monospace,monospace';
      const tw  = ctx.measureText(pl).width;
      ctx.fillStyle = bgC;
      ctx.fillRect(W - tw - 14, my - 8, tw + 10, 15);
      ctx.fillStyle = textC;
      ctx.textAlign = 'right';
      ctx.fillText(pl, W - 4, my + 4);
    }

    // Zaman etiketi (alt)
    const ts  = minT + (mx / W) * (maxT - minT);
    const dl  = new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
    const col = Math.min(Math.max(Math.floor(mx / cellW), 0), COLS - 1);
    ctx.font  = '9px ui-monospace,monospace';
    const tw2 = ctx.measureText(dl).width;
    ctx.fillStyle = bgC;
    ctx.fillRect(mx - tw2/2 - 4, PRICE_H - 16, tw2 + 8, 14);
    ctx.fillStyle = textC;
    ctx.textAlign = 'center';
    ctx.fillText(dl, mx, PRICE_H - 5);

    const candle = candles[col];
    if (!candle) return;

    const inLiqPanel = my > PRICE_H + 2;

    // Alt panelde X = fiyat ekseni
    const cursorPrice = inLiqPanel
      ? minP + (mx / W) * (maxP - minP)
      : minP + (1 - my / PRICE_H) * (maxP - minP);

    // Bucket'tan liq değerleri çek
    const { cumLong, cumShort, buckets, bucketW } = metaRef.current as typeof metaRef.current;
    let liqLong = 0, liqShort = 0;
    if (buckets.length > 0 && bucketW > 0) {
      const bi = Math.floor((cursorPrice - minP) / bucketW);
      if (bi >= 0 && bi < buckets.length) {
        liqLong  = buckets[bi].long;
        liqShort = buckets[bi].short;
      }
    }

    setTooltip({
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      date: dl,
      o: parseFloat(candle.o).toFixed(1),
      h: parseFloat(candle.h).toFixed(1),
      l: parseFloat(candle.l).toFixed(1),
      c: parseFloat(candle.c).toFixed(1),
      liqLong, liqShort,
      inLiqPanel,
      panelPrice: fmtP(cursorPrice),
      cumLong, cumShort,
    });
  }, []);

  const onMouseLeave = useCallback(() => {
    setTooltip(null);
    overlayRef.current?.getContext('2d')?.clearRect(0, 0, 9999, 9999);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const bg  = isDark ? '#06080f' : '#f8fafc';
  const bd  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  const t1  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.85)';
  const t2  = isDark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.4)';
  const bg2 = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: 960, maxWidth: '96vw', background: bg, border: `1px solid ${bd}`, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${bd}`, background: bg2 }}>
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={symbol} size={22} />
            <span className="text-[15px] font-bold" style={{ color: t1 }}>Liquidation Leverage Map</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded"
              style={{ background: 'rgba(0,210,200,0.15)', color: '#00d4c8' }}>{coin}</span>
          </div>
          <div className="flex items-center gap-2.5">
            {stats.price > 0 && (
              <span className="font-mono text-[13px] font-bold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(255,215,0,0.12)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.25)' }}>
                {fmtP(stats.price)}
              </span>
            )}
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="w-2 h-2 rounded-sm" style={{ background: isDark ? 'rgba(0,200,170,0.8)' : 'rgba(0,150,130,0.8)' }} />
              <span style={{ color: isDark ? 'rgba(0,200,170,0.9)' : 'rgba(0,130,110,0.9)' }}>Long {fmtU(stats.totalLong)}</span>
              <span className="w-2 h-2 rounded-sm ml-1" style={{ background: isDark ? 'rgba(255,80,80,0.8)' : 'rgba(210,50,50,0.8)' }} />
              <span style={{ color: isDark ? 'rgba(255,100,100,0.9)' : 'rgba(190,40,40,0.9)' }}>Short {fmtU(stats.totalShort)}</span>
            </div>
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[16px] hover:opacity-60 transition-opacity"
              style={{ color: t2, background: 'rgba(128,128,128,0.1)' }}>✕</button>
          </div>
        </div>

        {/* Range */}
        <div className="flex items-center gap-4 px-5 py-2" style={{ borderBottom: `1px solid ${bd}`, background: bg2 }}>
          <span className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: t2 }}>Range</span>
          <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${bd}` }}>
            {RANGES.map((r, i) => (
              <button key={r.label} onClick={() => setRangeIdx(i)}
                className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                style={{
                  background: rangeIdx === i ? (isDark ? 'rgba(0,210,200,0.2)' : 'rgba(0,150,140,0.15)') : 'transparent',
                  color:      rangeIdx === i ? '#00d4c8' : t2,
                  boxShadow:  rangeIdx === i ? '0 0 0 1px rgba(0,210,200,0.3)' : 'none',
                }}>{r.label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-[9px]" style={{ color: t2 }}>
            <span>Price chart <span style={{ color: isDark ? 'rgba(120,160,255,0.9)' : 'rgba(60,100,220,0.9)' }}>●</span></span>
            <span>Mark price <span style={{ color: '#FFD700' }}>- -</span></span>
            <span>Long liq <span style={{ color: isDark ? 'rgba(0,200,170,0.9)' : 'rgba(0,150,130,0.9)' }}>█</span></span>
            <span>Short liq <span style={{ color: isDark ? 'rgba(255,80,80,0.8)' : 'rgba(210,50,50,0.8)' }}>█</span></span>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative" style={{ height: 440 }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: bg }}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mb-3"
                style={{ borderColor: 'rgba(0,210,200,0.15)', borderTopColor: '#00d4c8' }} />
              <span className="text-[12px]" style={{ color: t2 }}>Loading {coin}...</span>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <span className="text-3xl">⚠️</span>
              <span className="text-[12px]" style={{ color: '#f87171' }}>{error}</span>
              <button onClick={() => setRangeIdx(i => i)} className="text-[11px] px-4 py-1.5 rounded-lg"
                style={{ background: 'rgba(0,210,200,0.1)', color: '#00d4c8', border: '1px solid rgba(0,210,200,0.25)' }}>
                Retry
              </button>
            </div>
          )}
          <canvas ref={canvasRef}  width={960} height={440} className="absolute inset-0 w-full h-full" />
          <canvas ref={overlayRef} width={960} height={440} className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} />

          {tooltip && (
            <div className="absolute pointer-events-none rounded-xl z-20"
              style={{
                left: Math.min(tooltip.x + 16, 660),
                top:  Math.max(tooltip.y - 10, 4),
                background: isDark ? 'rgba(6,8,15,0.96)' : 'rgba(248,250,252,0.97)',
                border: `1px solid ${bd}`,
                padding: '10px 14px',
                minWidth: 200,
                boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
              }}>
              {tooltip.inLiqPanel ? (
                // Alt panel tooltip — 2. görsel gibi
                <>
                  <div className="font-mono text-[12px] font-bold mb-2" style={{ color: t1 }}>
                    {tooltip.panelPrice}
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: isDark?'rgba(0,200,170,0.9)':'rgba(0,150,130,0.9)' }}/>
                        <span style={{ color: t2 }}>Liquidation Leverage</span>
                      </div>
                      <span className="font-mono font-bold" style={{ color: t1 }}>
                        {fmtU(tooltip.liqLong + tooltip.liqShort)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#FFD700' }}/>
                        <span style={{ color: t2 }}>Cumulative Long Liq</span>
                      </div>
                      <span className="font-mono font-bold" style={{ color: t1 }}>
                        {fmtU(tooltip.cumLong)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#FFD700' }}/>
                        <span style={{ color: t2 }}>Cumulative Short Liq</span>
                      </div>
                      <span className="font-mono font-bold" style={{ color: t1 }}>
                        {fmtU(tooltip.cumShort)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                // Üst panel tooltip — OHLC
                <>
                  <div className="font-mono text-[9px] mb-2 font-semibold" style={{ color: t2 }}>{tooltip.date}</div>
                  <div className="space-y-1 text-[11px]">
                    {[['Open', tooltip.o, t2], ['High', tooltip.h, isDark?'rgba(0,200,170,0.9)':'rgba(0,130,110,0.9)'],
                      ['Low',  tooltip.l, isDark?'rgba(255,100,100,0.9)':'rgba(190,40,40,0.9)'],
                      ['Close',tooltip.c, t1]].map(([k, v, col]) => (
                      <div key={k} className="flex items-center justify-between gap-4">
                        <span style={{ color: t2 }}>{k}</span>
                        <span className="font-mono font-semibold" style={{ color: col }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* X-axis */}
        <div className="flex justify-between px-3 py-1.5" style={{ borderTop: `1px solid ${bd}`, background: bg2 }}>
          {Array.from({ length: 8 }, (_, i) => {
            const { minT, maxT } = metaRef.current;
            const ts = minT && maxT ? minT + (i / 7) * (maxT - minT) : 0;
            return (
              <span key={i} className="text-[9px] font-mono" style={{ color: t2 }}>
                {ts ? new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).replace(',','') : '—'}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
