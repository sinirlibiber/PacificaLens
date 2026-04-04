'use client';
/**
 * LiquidationHeatmapModal — Coinglass-style Liquidation Leverage Heatmap
 *
 * X ekseni: zaman (kline candles)
 * Y ekseni: fiyat seviyeleri
 * Renk: o fiyat seviyesinde ne kadar liq leverage var (mor→cyan→sarı)
 * Sağ panel: kümülatif liq bar chart (long=teal üst, short=kırmızı alt)
 * Hover: fiyat seviyesindeki liq leverage miktarı
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle { t: number; o: string; h: string; l: string; c: string; v: string; }
interface LiqLevel { price: number; longLiq: number; shortLiq: number; }
interface Props { symbol: string; onClose: () => void; }

// Coinglass renk paleti: siyah→mor→cyan→sarı-yeşil
function liqColor(v: number): string {
  if (v <= 0) return 'transparent';
  const stops: [number, number, number, number, number][] = [
    [0,    20,   0,  40, 0.0 ],
    [0.05, 60,   0,  90, 0.3 ],
    [0.15, 100,  0, 150, 0.55],
    [0.30, 60,  80, 200, 0.70],
    [0.50, 0,  180, 200, 0.82],
    [0.70, 0,  220, 180, 0.90],
    [0.85, 80, 230, 100, 0.95],
    [1,   220, 255,  60, 1.0 ],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = lo[0] === hi[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const l = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgba(${l(lo[1],hi[1])},${l(lo[2],hi[2])},${l(lo[3],hi[3])},${(lo[4]+(hi[4]-lo[4])*t).toFixed(2)})`;
}

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

const PRICE_ROWS = 200; // fiyat bucket sayısı
const RIGHT_W    = 90;  // sağ panel genişliği

async function fetchCandles(symbol: string, interval: string, hours: number): Promise<Candle[]> {
  const end   = Date.now();
  const start = end - hours * 3600 * 1000;
  try {
    const path = encodeURIComponent(`kline?symbol=${symbol}&interval=${interval}&start_time=${start}&end_time=${end}`);
    const res  = await fetch(`/api/proxy?path=${path}`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (json?.success && Array.isArray(json.data) && json.data.length > 0) return json.data;
  } catch { /* fallback */ }

  // HyperLiquid fallback
  const coin = symbol.replace(/-USD$/i, '');
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime: Date.now() - hours*3600000, endTime: Date.now() } }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((c: Record<string,unknown>) => ({
          t: Number(c.t ?? c.T), o: String(c.o), h: String(c.h), l: String(c.l), c: String(c.c), v: String(c.v ?? '0'),
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
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState('');
  const [stats,    setStats   ] = useState({ price: 0, totalLong: 0, totalShort: 0 });
  const [tooltip,  setTooltip ] = useState<{ x:number; y:number; price:string; liqLong:number; liqShort:number; date:string } | null>(null);

  const coin = symbol.replace(/-USD$/i,'').replace(/-PERP$/i,'');

  const metaRef = useRef({
    minP: 0, maxP: 0, minT: 0, maxT: 0, W: 0, H: 0,
    cellW: 0, priceStep: 0, COLS: 0,
    // 2D grid: [col][priceRow] = {long, short} notional
    grid: [] as {long:number; short:number}[][],
    // kümülatif per price level (sağ panel)
    cumLong:  new Array(PRICE_ROWS).fill(0),
    cumShort: new Array(PRICE_ROWS).fill(0),
    candles: [] as Candle[],
    markPrice: 0,
  });

  const draw = useCallback((candles: Candle[], liqLevels: LiqLevel[], markPrice: number) => {
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
    const allH = candles.map(c => parseFloat(c.h));
    const allL = candles.map(c => parseFloat(c.l));
    let maxP = Math.max(...allH, markPrice);
    let minP = Math.min(...allL, markPrice);
    // Liq seviyeleri de dahil et
    for (const lv of liqLevels) {
      if (lv.price > 0) { maxP = Math.max(maxP, lv.price); minP = Math.min(minP, lv.price); }
    }
    const pad = (maxP - minP) * 0.12;
    maxP += pad; minP = Math.max(0, minP - pad);
    if (maxP <= minP) return;

    const times = candles.map(c => c.t > 1e12 ? c.t : c.t * 1000);
    const minT  = Math.min(...times);
    const maxT  = Math.max(...times);
    const COLS  = candles.length;
    const cellW = W / COLS;
    const priceStep = (maxP - minP) / PRICE_ROWS;

    // Grid: [COLS][PRICE_ROWS] = {long, short}
    const grid: {long:number; short:number}[][] =
      Array.from({length: COLS}, () =>
        Array.from({length: PRICE_ROWS}, () => ({long: 0, short: 0}))
      );
    const cumLong  = new Array(PRICE_ROWS).fill(0);
    const cumShort = new Array(PRICE_ROWS).fill(0);

    // Her liq seviyesini tüm candle sütunlarına dağıt (leverage haritası = statik)
    // Coinglass'ta her zaman diliminde aynı liq seviyeleri görünür
    const priceToRow = (px: number) => {
      const r = Math.floor((px - minP) / priceStep);
      return Math.max(0, Math.min(PRICE_ROWS - 1, r));
    };

    for (const lv of liqLevels) {
      if (lv.price <= 0) continue;
      const row = priceToRow(lv.price);
      // Spread: ±2 row
      for (let dr = -2; dr <= 2; dr++) {
        const r = row + dr;
        if (r < 0 || r >= PRICE_ROWS) continue;
        const w = dr === 0 ? 1 : Math.abs(dr) === 1 ? 0.6 : 0.3;
        cumLong[r]  += lv.longLiq  * w;
        cumShort[r] += lv.shortLiq * w;
        // Tüm sütunlara
        for (let ci = 0; ci < COLS; ci++) {
          grid[ci][r].long  += lv.longLiq  * w;
          grid[ci][r].short += lv.shortLiq * w;
        }
      }
    }

    // Normalize
    let maxVal = 0;
    for (let ci = 0; ci < COLS; ci++)
      for (let ri = 0; ri < PRICE_ROWS; ri++) {
        const v = grid[ci][ri].long + grid[ci][ri].short;
        if (v > maxVal) maxVal = v;
      }

    // Meta kaydet
    metaRef.current = { minP, maxP, minT, maxT, W, H, cellW, priceStep, COLS, grid, cumLong, cumShort, candles, markPrice };

    // ── BG ──
    ctx.fillStyle = dark ? '#04060f' : '#f0f4f8';
    ctx.fillRect(0, 0, CW, H);

    // ── Heatmap cells ──
    const cellH = H / PRICE_ROWS;
    for (let ci = 0; ci < COLS; ci++) {
      for (let ri = 0; ri < PRICE_ROWS; ri++) {
        const v = grid[ci][ri].long + grid[ci][ri].short;
        if (v <= 0) continue;
        const norm = Math.pow(v / maxVal, 0.4);
        if (norm < 0.03) continue;
        ctx.fillStyle = liqColor(norm);
        const x = Math.floor(ci * cellW);
        const y = H - Math.floor((ri + 1) * cellH); // fiyat yukarı = canvas aşağı
        ctx.fillRect(x, y, Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
      }
    }

    // ── Candle mum çubukları (üste) ──
    for (let ci = 0; ci < COLS; ci++) {
      const c      = candles[ci];
      const open   = parseFloat(c.o), close = parseFloat(c.c);
      const high   = parseFloat(c.h), low   = parseFloat(c.l);
      const isGreen = close >= open;
      const x  = ci * cellW + cellW * 0.2;
      const w  = cellW * 0.6;

      const toY = (px: number) => H - ((px - minP) / (maxP - minP)) * H;
      const yH  = toY(high), yL = toY(low);
      const yO  = toY(Math.max(open, close));
      const yC  = toY(Math.min(open, close));

      // Wick
      ctx.strokeStyle = isGreen ? '#26a69a' : '#ef5350';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(x + w/2, yH); ctx.lineTo(x + w/2, yL); ctx.stroke();
      // Body
      ctx.fillStyle = isGreen ? '#26a69a' : '#ef5350';
      const bodyH = Math.max(1, yC - yO);
      ctx.fillRect(x, yO, w, bodyH);
    }

    // ── Mark price line ──
    if (markPrice > 0) {
      const y = H - ((markPrice - minP) / (maxP - minP)) * H;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = 'rgba(255,215,0,0.5)';
      ctx.shadowBlur  = 3;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]); ctx.shadowBlur = 0;
      // Fiyat etiketi
      const label = fmtP(markPrice);
      ctx.font = 'bold 10px ui-monospace,monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(W - tw - 16, y - 9, tw + 12, 17);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'right';
      ctx.fillText(label, W - 4, y + 4);
    }

    // ── Y-axis fiyat etiketleri ──
    ctx.font = '9px ui-monospace,monospace';
    ctx.textAlign = 'right';
    const lc  = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
    const lbg = dark ? 'rgba(4,6,15,0.8)'      : 'rgba(240,244,248,0.9)';
    for (let i = 0; i <= 8; i++) {
      const pct   = i / 8;
      const price = minP + pct * (maxP - minP);
      const y     = H - pct * H;
      const lbl   = fmtP(price);
      const tw    = ctx.measureText(lbl).width;
      ctx.fillStyle = lbg;
      ctx.fillRect(W - tw - 14, y - 7, tw + 10, 14);
      ctx.fillStyle = lc;
      ctx.fillText(lbl, W - 4, y + 4);
    }

    // ── Sağ panel: kümülatif liq bar ──
    const rx = W + 1;
    const rw = RIGHT_W - 2;
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.6)' : 'rgba(200,210,230,0.5)';
    ctx.fillRect(rx, 0, rw, H);

    const maxCum = Math.max(...cumLong, ...cumShort, 1);

    for (let ri = 0; ri < PRICE_ROWS; ri++) {
      const y  = H - (ri + 1) * cellH;
      const lo = cumLong[ri];
      const sh = cumShort[ri];

      // Long = teal (sağa doğru)
      if (lo > 0) {
        const bw = (lo / maxCum) * rw * 0.9;
        const vn = Math.pow(lo / Math.max(...cumLong, 1), 0.45);
        ctx.fillStyle = liqColor(Math.min(vn * 0.8 + 0.2, 1));
        ctx.fillRect(rx, y, bw, Math.max(cellH - 0.5, 0.5));
      }
      // Short = overlay with slight red tint on top half
      if (sh > 0) {
        const bw = (sh / maxCum) * rw * 0.9;
        const vn = Math.pow(sh / Math.max(...cumShort, 1), 0.45);
        ctx.fillStyle = `rgba(255,80,80,${vn * 0.7})`;
        ctx.fillRect(rx, y, bw, Math.max(cellH - 0.5, 0.5));
      }
    }

    // Sağ panel border
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, H); ctx.stroke();

    setStats({
      price:      markPrice || parseFloat(candles[candles.length-1]?.c || '0'),
      totalLong:  liqLevels.reduce((s, lv) => s + lv.longLiq, 0),
      totalShort: liqLevels.reduce((s, lv) => s + lv.shortLiq, 0),
    });
    setLoading(false);
  }, []);

  // Fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const range = RANGES[rangeIdx];

    Promise.all([
      fetchCandles(symbol, range.interval, range.hours),
      fetch(`/api/liq-leverage?symbol=${encodeURIComponent(symbol)}&hours=${range.hours}`)
        .then(r => r.ok ? r.json() : { levels: [], markPrice: 0 })
        .catch(() => ({ levels: [], markPrice: 0 })),
    ]).then(([candles, liqData]) => {
      if (cancelled) return;
      if (!candles.length) { setError('Kline verisi yüklenemedi'); setLoading(false); return; }
      draw(candles, liqData.levels ?? [], liqData.markPrice ?? 0);
    }).catch(err => {
      if (!cancelled) { setError(String(err)); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [symbol, rangeIdx, draw]);

  // Crosshair + tooltip
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const oc = overlayRef.current;
    if (!oc) return;
    const rect  = oc.getBoundingClientRect();
    const mx    = (e.clientX - rect.left) * (oc.width / rect.width);
    const my    = (e.clientY - rect.top)  * (oc.height / rect.height);
    const { minP, maxP, minT, maxT, W, H, cellW, priceStep, COLS, grid, cumLong, cumShort, candles } = metaRef.current;
    if (!COLS || !W) return;

    const dark = document.documentElement.classList.contains('dark');
    const ctx  = oc.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, oc.width, oc.height);

    if (mx > W) {
      // Sağ panelde: fiyat seviyesi göster
      const pct   = 1 - my / H;
      const price = minP + pct * (maxP - minP);
      const ri    = Math.max(0, Math.min(PRICE_ROWS - 1, Math.floor(pct * PRICE_ROWS)));
      ctx.strokeStyle = 'rgba(255,215,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(oc.width, my); ctx.stroke();
      setTooltip({
        x: e.clientX - rect.left, y: e.clientY - rect.top,
        price:    fmtP(price),
        liqLong:  cumLong[ri]  || 0,
        liqShort: cumShort[ri] || 0,
        date: '',
      });
      return;
    }

    // Crosshair
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
    ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(W, my); ctx.stroke();
    ctx.setLineDash([]);

    const price = minP + (1 - my / H) * (maxP - minP);
    const ts    = minT + (mx / W) * (maxT - minT);
    const col   = Math.min(Math.max(Math.floor(mx / cellW), 0), COLS - 1);
    const ri    = Math.max(0, Math.min(PRICE_ROWS - 1, Math.floor((1 - my / H) * PRICE_ROWS)));

    const liqLong  = grid[col]?.[ri]?.long  || 0;
    const liqShort = grid[col]?.[ri]?.short || 0;

    // Fiyat etiketi sağda
    const pl = fmtP(price);
    ctx.font  = '10px ui-monospace,monospace';
    const tw  = ctx.measureText(pl).width;
    ctx.fillStyle = dark ? 'rgba(4,6,15,0.9)' : 'rgba(240,244,248,0.95)';
    ctx.fillRect(W - tw - 14, my - 8, tw + 10, 15);
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
    ctx.textAlign = 'right';
    ctx.fillText(pl, W - 4, my + 4);

    // Zaman etiketi altta
    const dl = new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).replace(',','');
    ctx.textAlign = 'center';
    ctx.font = '9px ui-monospace,monospace';
    ctx.fillStyle = dark ? 'rgba(4,6,15,0.9)' : 'rgba(240,244,248,0.95)';
    const tw2 = ctx.measureText(dl).width;
    ctx.fillRect(mx - tw2/2 - 4, H - 16, tw2 + 8, 14);
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
    ctx.fillText(dl, mx, H - 5);

    setTooltip({
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      price: fmtP(price), liqLong, liqShort,
      date: dl,
    });
  }, []);

  const onMouseLeave = useCallback(() => {
    setTooltip(null);
    overlayRef.current?.getContext('2d')?.clearRect(0, 0, 9999, 9999);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const bg   = dark ? '#04060f' : '#ffffff';
  const bg2  = dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)';
  const bd   = dark ? 'rgba(255,255,255,0.08)'   : 'rgba(0,0,0,0.09)';
  const t1   = dark ? 'rgba(255,255,255,0.88)'   : 'rgba(0,0,0,0.85)';
  const t2   = dark ? 'rgba(255,255,255,0.4)'    : 'rgba(0,0,0,0.4)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: 1020, maxWidth: '96vw', background: bg, border: `1px solid ${bd}`, boxShadow: '0 30px 80px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ background: bg2, borderBottom: `1px solid ${bd}` }}>
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={symbol} size={22} />
            <span className="text-[15px] font-bold" style={{ color: t1 }}>Liquidation Leverage Map</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(0,210,200,0.15)', color: '#00d4c8' }}>{coin}</span>
          </div>
          <div className="flex items-center gap-3">
            {stats.price > 0 && (
              <span className="font-mono text-[13px] font-bold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(255,215,0,0.1)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.25)' }}>
                {fmtP(stats.price)}
              </span>
            )}
            {(stats.totalLong > 0 || stats.totalShort > 0) && (
              <div className="flex gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded font-semibold"
                  style={{ background: 'rgba(0,210,200,0.1)', color: '#00d4c8', border: '1px solid rgba(0,210,200,0.2)' }}>
                  Long: {fmtU(stats.totalLong)}
                </span>
                <span className="px-2 py-0.5 rounded font-semibold"
                  style={{ background: 'rgba(255,80,80,0.1)', color: '#ff6060', border: '1px solid rgba(255,80,80,0.2)' }}>
                  Short: {fmtU(stats.totalShort)}
                </span>
              </div>
            )}
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[16px] hover:opacity-60 transition-opacity"
              style={{ color: t2, background: 'rgba(255,255,255,0.06)' }}>✕</button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-5 px-5 py-2" style={{ borderBottom: `1px solid ${bd}`, background: bg2 }}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: t2 }}>Range</span>
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${bd}` }}>
              {RANGES.map((r, i) => (
                <button key={r.label} onClick={() => setRangeIdx(i)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background: rangeIdx === i ? 'rgba(0,210,200,0.2)' : 'transparent',
                    color:      rangeIdx === i ? '#00d4c8' : t2,
                    boxShadow:  rangeIdx === i ? '0 0 0 1px rgba(0,210,200,0.3)' : 'none',
                  }}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[9px] font-semibold" style={{ color: t2 }}>Low</span>
            <div className="flex gap-0.5">
              {[0.05, 0.2, 0.4, 0.6, 0.8, 1].map((v, i) => (
                <div key={i} className="w-6 h-2.5 rounded-sm" style={{ background: liqColor(v) }} />
              ))}
            </div>
            <span className="text-[9px] font-semibold" style={{ color: '#FFD700' }}>High Liq</span>
            <div style={{ width: 1, height: 12, background: bd }} className="mx-1" />
            <div className="flex items-center gap-1">
              <div className="w-6 h-1" style={{ background: '#FFD700' }} />
              <span className="text-[9px]" style={{ color: '#FFD700' }}>Mark Price</span>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative" style={{ height: 440 }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: bg }}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mb-3"
                style={{ borderColor: 'rgba(0,210,200,0.15)', borderTopColor: '#00d4c8' }} />
              <span className="text-[12px]" style={{ color: t2 }}>Loading {coin} leverage map...</span>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <span className="text-3xl">⚠️</span>
              <span className="text-[12px]" style={{ color: '#f87171' }}>{error}</span>
              <button onClick={() => setRangeIdx(i => i)}
                className="text-[11px] px-4 py-1.5 rounded-lg"
                style={{ background: 'rgba(0,210,200,0.1)', color: '#00d4c8', border: '1px solid rgba(0,210,200,0.25)' }}>
                Retry
              </button>
            </div>
          )}
          <canvas ref={mainRef}    width={1020} height={440} className="absolute inset-0 w-full h-full" />
          <canvas ref={overlayRef} width={1020} height={440} className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} />

          {tooltip && (
            <div className="absolute pointer-events-none rounded-xl px-3 py-2.5 text-[11px] z-20"
              style={{
                left: Math.min(tooltip.x + 16, 700),
                top:  Math.max(tooltip.y - 10, 4),
                background: dark ? 'rgba(4,6,15,0.96)' : 'rgba(255,255,255,0.97)',
                border: `1px solid ${bd}`,
                color: t1,
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                minWidth: 180,
              }}>
              {tooltip.date && <div className="font-mono text-[9px] mb-1.5" style={{ color: t2 }}>{tooltip.date}</div>}
              <div className="mb-1">Price: <span className="font-mono font-bold">{tooltip.price}</span></div>
              {(tooltip.liqLong > 0 || tooltip.liqShort > 0) && (
                <>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#00d4c8' }}/>
                    <span>Liquidation Leverage</span>
                    <span className="ml-auto font-bold">{fmtU(tooltip.liqLong + tooltip.liqShort)}</span>
                  </div>
                  {tooltip.liqLong > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px]" style={{ color: t2 }}>
                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#00d4c8' }}/>
                      Long liq: <span className="ml-auto">{fmtU(tooltip.liqLong)}</span>
                    </div>
                  )}
                  {tooltip.liqShort > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px]" style={{ color: t2 }}>
                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#ff6060' }}/>
                      Short liq: <span className="ml-auto">{fmtU(tooltip.liqShort)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* X-axis */}
        <div className="flex justify-between px-3 py-1.5" style={{ borderTop: `1px solid ${bd}`, background: bg2 }}>
          {Array.from({length: 8}, (_, i) => {
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
