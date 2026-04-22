'use client';
/**
 * LiquidationHeatmapModal — Premium redesign
 * Upper panel : Price line chart with area fill + OHLC tooltip
 * Lower panel : Liq leverage bar chart (long=teal, short=red) by price level
 * Full dark / light theme support via getTheme() color tokens
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CoinLogo } from './CoinLogo';

interface Candle   { t: number; o: string; h: string; l: string; c: string; v: string; }
interface LiqLevel { price: number; longLiq: number; shortLiq: number; }
interface Props    { symbol: string; onClose: () => void; }

const fmtP = (p: number) =>
  p >= 10000 ? '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : p >= 1   ? '$' + p.toFixed(2)
  : '$' + p.toPrecision(4);

const fmtU = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M`
  : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K`
  : `$${v.toFixed(0)}`;

const RANGES = [
  { label: '12h', hours: 12,  interval: '15m' },
  { label: '24h', hours: 24,  interval: '1h'  },
  { label: '48h', hours: 48,  interval: '2h'  },
  { label: '7d',  hours: 168, interval: '4h'  },
];

/* ─── Color tokens — one source of truth for dark & light ─── */
function getTheme(dark: boolean) {
  return dark ? {
    bgModal:         '#06080f',
    bgHeader:        'rgba(255,255,255,0.025)',
    bgPanel:         '#080b16',
    border:          'rgba(255,255,255,0.08)',
    borderMid:       'rgba(255,255,255,0.05)',
    text1:           'rgba(255,255,255,0.90)',
    text2:           'rgba(255,255,255,0.45)',
    text3:           'rgba(255,255,255,0.25)',
    priceStroke:     'rgba(100,160,255,0.95)',
    priceFill0:      'rgba(80,130,255,0.22)',
    priceFill1:      'rgba(80,130,255,0.00)',
    markLine:        'rgba(255,215,0,0.85)',
    markBg:          '#FFD700',
    markText:        '#000',
    longBar0:        'rgba(0,230,190,0.90)',
    longBar1:        'rgba(0,180,150,0.25)',
    shortBar0:       'rgba(255,90,90,0.90)',
    shortBar1:       'rgba(220,60,60,0.20)',
    longLine:        'rgba(0,240,200,0.95)',
    shortLine:       'rgba(255,100,100,0.95)',
    priceBadgeBg:    '#FFD700',
    priceBadgeText:  '#000',
    priceBadgeGlow:  '0 0 12px rgba(255,215,0,0.28)',
    accentTeal:      '#00d4c8',
    accentTealBg:    'rgba(0,210,200,0.15)',
    longColor:       'rgba(0,200,170,0.9)',
    shortColor:      'rgba(255,100,100,0.9)',
    btnActiveBg:     'rgba(0,210,200,0.18)',
    btnActiveColor:  '#00d4c8',
    btnActiveShadow: '0 0 0 1px rgba(0,210,200,0.35)',
    spinBorder:      'rgba(0,210,200,0.15)',
    spinTop:         '#00d4c8',
    tooltipBg:       'rgba(6,8,20,0.97)',
    grid:            'rgba(255,255,255,0.045)',
    vertGrid:        'rgba(255,255,255,0.03)',
    crosshair:       'rgba(255,255,255,0.20)',
    labelBg:         'rgba(6,8,20,0.88)',
    markDash:        '#FFD700',
    glow:            true,
    panelGrad0:      '#0a0d1a',
    panelGrad1:      '#06080f',
    xAxisBg:         'rgba(255,255,255,0.015)',
    rangeInner:      'rgba(255,255,255,0.04)',
    divGradMid:      'rgba(0,210,200,0.4)',
    modalShadow:     '0 32px 80px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(255,255,255,0.06)',
    btnBg:           'rgba(255,255,255,0.06)',
  } : {
    bgModal:         '#f4f7fb',
    bgHeader:        'rgba(0,0,0,0.025)',
    bgPanel:         '#ffffff',
    border:          'rgba(0,0,0,0.10)',
    borderMid:       'rgba(0,0,0,0.06)',
    text1:           'rgba(0,0,0,0.88)',
    text2:           'rgba(0,0,0,0.45)',
    text3:           'rgba(0,0,0,0.25)',
    priceStroke:     'rgba(30,90,220,0.95)',
    priceFill0:      'rgba(30,90,220,0.14)',
    priceFill1:      'rgba(30,90,220,0.00)',
    markLine:        'rgba(26,86,219,0.90)',
    markBg:          '#1a56db',
    markText:        '#fff',
    longBar0:        'rgba(0,160,130,0.90)',
    longBar1:        'rgba(0,120,100,0.20)',
    shortBar0:       'rgba(210,50,50,0.90)',
    shortBar1:       'rgba(180,40,40,0.18)',
    longLine:        'rgba(0,160,130,0.95)',
    shortLine:       'rgba(200,50,50,0.95)',
    priceBadgeBg:    '#1a56db',
    priceBadgeText:  '#fff',
    priceBadgeGlow:  'none',
    accentTeal:      '#0891b2',
    accentTealBg:    'rgba(8,145,178,0.12)',
    longColor:       'rgba(0,140,110,0.95)',
    shortColor:      'rgba(190,40,40,0.95)',
    btnActiveBg:     'rgba(8,145,178,0.14)',
    btnActiveColor:  '#0891b2',
    btnActiveShadow: '0 0 0 1px rgba(8,145,178,0.35)',
    spinBorder:      'rgba(8,145,178,0.18)',
    spinTop:         '#0891b2',
    tooltipBg:       'rgba(248,250,252,0.98)',
    grid:            'rgba(0,0,0,0.055)',
    vertGrid:        'rgba(0,0,0,0.035)',
    crosshair:       'rgba(0,0,0,0.20)',
    labelBg:         'rgba(248,250,252,0.92)',
    markDash:        '#1a56db',
    glow:            false,
    panelGrad0:      '#ffffff',
    panelGrad1:      '#f1f5f9',
    xAxisBg:         'rgba(0,0,0,0.015)',
    rangeInner:      'rgba(0,0,0,0.04)',
    divGradMid:      'rgba(30,90,220,0.3)',
    modalShadow:     '0 24px 60px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.08)',
    btnBg:           'rgba(0,0,0,0.06)',
  };
}

/* ─── Candle fetcher ───────────────────────────────────────── */
async function fetchCandles(symbol: string, interval: string, hours: number): Promise<Candle[]> {
  const end = Date.now(), start = end - hours * 3600000;
  try {
    const path = encodeURIComponent(`kline?symbol=${symbol}&interval=${interval}&start_time=${start}&end_time=${end}`);
    const res  = await fetch(`/api/proxy?path=${path}`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (json?.success && Array.isArray(json.data) && json.data.length > 0) return json.data;
  } catch { /* fallback */ }

  const coin = symbol.replace(/-USD$/i, '');
  const HIP3_MAP: Record<string, string> = {
    SP500: 'xyz:SP500', XAU: 'xyz:GOLD', CL: 'xyz:CL', TSLA: 'xyz:TSLA',
    NVDA: 'xyz:NVDA', GOOGL: 'xyz:GOOGL', PLTR: 'xyz:PLTR', SILVER: 'xyz:SILVER',
    COPPER: 'xyz:COPPER', NATGAS: 'xyz:NATGAS', PLATINUM: 'xyz:PLATINUM',
    URNM: 'xyz:URNM', HOOD: 'xyz:HOOD', CRCL: 'xyz:CRCL',
    EURUSD: 'xyz:EUR', USDJPY: 'xyz:JPY',
  };
  const hlCoin = HIP3_MAP[coin.toUpperCase()] ?? coin;
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'candleSnapshot', req: { coin: hlCoin, interval, startTime: start, endTime: end } }),
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

/* ─── Component ──────────────────────────────────────────── */
export default function LiquidationHeatmapModal({ symbol, onClose }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState('');
  const [stats,    setStats   ] = useState({ price: 0, totalLong: 0, totalShort: 0 });
  const [tooltip,  setTooltip ] = useState<{
    clientX: number; clientY: number;
    date: string; o: string; h: string; l: string; c: string;
    liqLong: number; liqShort: number;
    inLiqPanel: boolean; panelPrice: string;
    cumLong: number; cumShort: number;
  } | null>(null);

  const zoomRef = useRef({ offset: 0, zoom: 1.0 });
  const dragRef = useRef({ dragging: false, startX: 0, startOffset: 0 });
  const coin    = symbol.replace(/-USD$/i, '').replace(/-PERP$/i, '');

  const metaRef = useRef({
    candles: [] as Candle[], liqByPrice: [] as { price: number; long: number; short: number }[],
    minP: 0, maxP: 0, minT: 0, maxT: 0,
    W: 0, H: 0, PRICE_H: 0, LIQ_H: 0, COLS: 0, cellW: 0,
    markPrice: 0, isDark: true,
    cumLong: 0, cumShort: 0, buckets: [] as { long: number; short: number }[], bucketW: 0,
  });

  const allCandlesRef = useRef<Candle[]>([]);
  const liqLevelsRef  = useRef<LiqLevel[]>([]);
  const markPriceRef  = useRef(0);
  const isDarkRef     = useRef(true);

  /* ── draw ─────────────────────────────────────────────── */
  const draw = useCallback((
    candles: Candle[], liqLevels: LiqLevel[], markPrice: number, isDark: boolean,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || !candles.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const T  = getTheme(isDark);
    const CW = canvas.width, CH = canvas.height;

    const { offset, zoom } = zoomRef.current;
    const total        = candles.length;
    const visibleCount = Math.max(10, Math.round(total * zoom));
    const startIdx     = Math.max(0, Math.min(total - visibleCount, offset));
    const dc           = candles.slice(startIdx, startIdx + visibleCount);
    const display      = dc.length > 0 ? dc : candles;

    const PRICE_H = Math.round(CH * 0.76);
    const LIQ_H   = CH - PRICE_H - 2;

    const allH = display.map(c => parseFloat(c.h));
    const allL = display.map(c => parseFloat(c.l));
    let maxP = Math.max(...allH, markPrice);
    let minP = Math.min(...allL, markPrice);
    const pad = (maxP - minP) * 0.10;
    maxP += pad; minP = Math.max(0, minP - pad);

    const times  = display.map(c => c.t > 1e12 ? c.t : c.t * 1000);
    const minT   = Math.min(...times), maxT = Math.max(...times);
    const COLS   = display.length, cellW = CW / COLS;
    const closes = display.map(c => parseFloat(c.c));

    const toY = (p: number) => PRICE_H - ((p - minP) / (maxP - minP)) * PRICE_H;
    const toX = (p: number) => ((p - minP) / (maxP - minP)) * CW;

    const visible = liqLevels.filter(lv => lv.price >= minP && lv.price <= maxP).sort((a, b) => a.price - b.price);

    metaRef.current = {
      candles: display, liqByPrice: visible.map(lv => ({ price: lv.price, long: lv.longLiq, short: lv.shortLiq })),
      minP, maxP, minT, maxT, W: CW, H: CH, PRICE_H, LIQ_H, COLS, cellW, markPrice, isDark,
      cumLong: 0, cumShort: 0, buckets: [], bucketW: 0,
    };

    /* BG */
    ctx.fillStyle = T.bgModal; ctx.fillRect(0, 0, CW, CH);

    /* Upper panel BG */
    const bg = ctx.createLinearGradient(0, 0, 0, PRICE_H);
    bg.addColorStop(0, T.bgPanel); bg.addColorStop(1, T.bgModal);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, PRICE_H);

    /* Grid */
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const y = (i / 6) * PRICE_H;
      ctx.strokeStyle = T.grid;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
      const x = (i / 8) * CW;
      ctx.strokeStyle = T.vertGrid;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PRICE_H); ctx.stroke();
    }

    /* Area fill */
    ctx.beginPath();
    for (let i = 0; i < closes.length; i++) {
      const x = (i + 0.5) * cellW, y = toY(closes[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo((closes.length - 0.5) * cellW, PRICE_H);
    ctx.lineTo(0.5 * cellW, PRICE_H);
    ctx.closePath();
    const aG = ctx.createLinearGradient(0, 0, 0, PRICE_H);
    aG.addColorStop(0, T.priceFill0); aG.addColorStop(1, T.priceFill1);
    ctx.fillStyle = aG; ctx.fill();

    /* Price line */
    ctx.beginPath(); ctx.strokeStyle = T.priceStroke; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let i = 0; i < closes.length; i++) {
      const x = (i + 0.5) * cellW, y = toY(closes[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    /* Y-axis labels */
    ctx.font = '9px ui-monospace,monospace'; ctx.fillStyle = T.text2; ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const pct = i / 5, price = minP + pct * (maxP - minP), y = PRICE_H - pct * PRICE_H;
      if (y < 10 || y > PRICE_H - 4) continue;
      ctx.fillText(fmtP(price), CW - 6, y + 3);
    }

    /* Mark price line */
    if (markPrice > 0) {
      const y = toY(markPrice);
      if (y >= 0 && y <= PRICE_H) {
        ctx.setLineDash([5, 5]); ctx.strokeStyle = T.markLine; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); ctx.setLineDash([]);
        const lbl = fmtP(markPrice); ctx.font = 'bold 10px ui-monospace,monospace';
        const tw = ctx.measureText(lbl).width, bw = tw + 16, bx = CW - bw - 2, by = y - 9;
        if (isDark) { ctx.shadowColor = T.markBg; ctx.shadowBlur = 8; }
        ctx.fillStyle = T.markBg; ctx.beginPath(); ctx.roundRect(bx, by, bw, 18, 4); ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        ctx.fillStyle = T.markText; ctx.textAlign = 'right'; ctx.fillText(lbl, CW - 6, y + 4);
      }
    }

    /* Divider */
    const dG = ctx.createLinearGradient(0, 0, CW, 0);
    dG.addColorStop(0, 'transparent'); dG.addColorStop(0.3, T.divGradMid);
    dG.addColorStop(0.7, T.divGradMid); dG.addColorStop(1, 'transparent');
    ctx.fillStyle = dG; ctx.fillRect(0, PRICE_H, CW, 1.5);

    /* Lower panel BG */
    const hG = ctx.createLinearGradient(0, PRICE_H + 2, 0, PRICE_H + 2 + LIQ_H);
    hG.addColorStop(0, T.panelGrad0); hG.addColorStop(1, T.panelGrad1);
    ctx.fillStyle = hG; ctx.fillRect(0, PRICE_H + 2, CW, LIQ_H);
    ctx.strokeStyle = T.grid; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const y = PRICE_H + 2 + (i / 3) * LIQ_H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
    }

    /* Liq bars */
    if (visible.length > 0) {
      const BUCKETS = 120, bucketW = (maxP - minP) / BUCKETS;
      const buckets: { long: number; short: number }[] = Array.from({ length: BUCKETS }, () => ({ long: 0, short: 0 }));
      for (const lv of visible) {
        const bi = Math.floor((lv.price - minP) / bucketW);
        if (bi >= 0 && bi < BUCKETS) { buckets[bi].long += lv.longLiq; buckets[bi].short += lv.shortLiq; }
      }
      const maxBucket = Math.max(...buckets.map(b => b.long + b.short), 1);
      const barPixW = Math.max(2, CW / BUCKETS - 0.5), maxBarH = LIQ_H * 0.88, panelTop = PRICE_H + 2;

      let runLong = 0, runShort = 0;
      const cumLongArr: number[] = new Array(BUCKETS).fill(0);
      const cumShortArr: number[] = new Array(BUCKETS).fill(0);
      for (let bi = 0; bi < BUCKETS; bi++) {
        runLong += buckets[bi].long; runShort += buckets[bi].short;
        cumLongArr[bi] = runLong; cumShortArr[bi] = runShort;
      }
      const maxCumLong = Math.max(...cumLongArr, 1), maxCumShort = Math.max(...cumShortArr, 1);

      for (let bi = 0; bi < BUCKETS; bi++) {
        const b = buckets[bi], total = b.long + b.short;
        if (total < maxBucket * 0.008) continue;
        const x = toX(minP + (bi + 0.5) * bucketW);
        const normH = Math.pow(total / maxBucket, 0.55) * maxBarH;
        const barW = Math.max(3, barPixW), radius = Math.min(2.5, barW / 3);
        const longH = total > 0 ? (b.long / total) * normH : 0;
        const shortH = total > 0 ? (b.short / total) * normH : 0;

        if (longH > 1) {
          const gy = panelTop + LIQ_H - longH;
          const g = ctx.createLinearGradient(0, gy, 0, gy + longH);
          g.addColorStop(0, T.longBar0); g.addColorStop(1, T.longBar1);
          ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x - barW / 2, gy, barW, longH, [radius, radius, 0, 0]); ctx.fill();
        }
        if (shortH > 1) {
          const gy = panelTop + LIQ_H - longH - shortH;
          const g2 = ctx.createLinearGradient(0, gy, 0, gy + shortH);
          g2.addColorStop(0, T.shortBar0); g2.addColorStop(1, T.shortBar1);
          ctx.fillStyle = g2; ctx.beginPath(); ctx.roundRect(x - barW / 2, gy, barW, shortH, [radius, radius, 0, 0]); ctx.fill();
        }
        if (T.glow && total > maxBucket * 0.35) {
          ctx.shadowColor = b.long > b.short ? T.longBar0 : T.shortBar0; ctx.shadowBlur = 8;
          ctx.fillStyle = 'transparent'; ctx.fillRect(x - barW / 2, panelTop + LIQ_H - normH, barW, normH);
          ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        }
      }

      /* cumulative lines */
      ctx.beginPath(); ctx.strokeStyle = T.longLine; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
      let cLS = false;
      for (let bi = 0; bi < BUCKETS; bi++) {
        if (cumLongArr[bi] <= 0) continue;
        const x = toX(minP + (bi + 0.5) * bucketW);
        const y = panelTop + LIQ_H - (cumLongArr[bi] / maxCumLong) * maxBarH * 0.90;
        if (!cLS) { ctx.moveTo(x, y); cLS = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath(); ctx.strokeStyle = T.shortLine; ctx.lineWidth = 1.8;
      let cSS = false;
      for (let bi = 0; bi < BUCKETS; bi++) {
        if (cumShortArr[bi] <= 0) continue;
        const x = toX(minP + (bi + 0.5) * bucketW);
        const y = panelTop + LIQ_H - (cumShortArr[bi] / maxCumShort) * maxBarH * 0.90;
        if (!cSS) { ctx.moveTo(x, y); cSS = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const cumLong = cumLongArr[BUCKETS - 1] || 0, cumShort = cumShortArr[BUCKETS - 1] || 0;
      Object.assign(metaRef.current, { cumLong, cumShort, buckets, bucketW });

      if (markPrice > 0) {
        const x = toX(markPrice);
        ctx.setLineDash([3, 4]); ctx.strokeStyle = T.markDash; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(x, panelTop); ctx.lineTo(x, panelTop + LIQ_H); ctx.stroke();
        ctx.globalAlpha = 1; ctx.setLineDash([]);
      }
    }

    /* Lower panel labels */
    ctx.font = '9px ui-monospace,monospace'; ctx.fillStyle = T.text3; ctx.textAlign = 'left';
    ctx.fillText('Liq Leverage', 8, PRICE_H + 14);
    ctx.textAlign = 'center';
    for (let i = 0; i <= 6; i++) {
      const pct = i / 6, price = minP + pct * (maxP - minP), x = pct * CW;
      ctx.fillStyle = T.text2; ctx.fillText(fmtP(price), x, PRICE_H + 2 + LIQ_H - 3);
    }

    setStats({
      price: markPrice || closes[closes.length - 1] || 0,
      totalLong:  liqLevels.reduce((s, lv) => s + lv.longLiq,  0),
      totalShort: liqLevels.reduce((s, lv) => s + lv.shortLiq, 0),
    });
    setLoading(false);
  }, []);

  /* ── Load data ─────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const range  = RANGES[rangeIdx];
    const isDark = document.documentElement.classList.contains('dark');
    isDarkRef.current = isDark;

    Promise.all([
      fetchCandles(symbol, range.interval, range.hours),
      fetch(`/api/liq-leverage?symbol=${encodeURIComponent(symbol)}&hours=${range.hours}`)
        .then(r => r.ok ? r.json() : { levels: [], markPrice: 0 })
        .catch(() => ({ levels: [], markPrice: 0 })),
    ]).then(([candles, liqData]) => {
      if (cancelled) return;
      if (!candles.length) { setError('Could not load data'); setLoading(false); return; }
      allCandlesRef.current = candles;
      liqLevelsRef.current  = liqData.levels ?? [];
      markPriceRef.current  = liqData.markPrice ?? 0;
      draw(candles, liqData.levels ?? [], liqData.markPrice ?? 0, isDark);
    }).catch(err => { if (!cancelled) { setError(String(err)); setLoading(false); } });

    return () => { cancelled = true; };
  }, [symbol, rangeIdx, draw]);

  const redraw = useCallback(() => {
    if (!allCandlesRef.current.length) return;
    draw(allCandlesRef.current, liqLevelsRef.current, markPriceRef.current, isDarkRef.current);
  }, [draw]);

  /* ── Overlay / mouse ─────────────────────────────────── */
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current.dragging) {
      const oc = overlayRef.current; if (!oc) return;
      const rect = oc.getBoundingClientRect();
      const dx    = e.clientX - dragRef.current.startX;
      const total = allCandlesRef.current.length;
      const vis   = Math.round(total * zoomRef.current.zoom);
      const shift = Math.round(-dx / (rect.width / vis));
      zoomRef.current.offset = Math.max(0, Math.min(total - vis, dragRef.current.startOffset + shift));
      redraw(); return;
    }
    const oc = overlayRef.current; if (!oc) return;
    const rect = oc.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (oc.width  / rect.width);
    const my   = (e.clientY - rect.top)  * (oc.height / rect.height);
    const { candles, minP, maxP, minT, maxT, W, PRICE_H, LIQ_H, COLS, cellW, isDark } = metaRef.current;
    if (!COLS || !W) return;
    const ctx = oc.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, oc.width, oc.height);
    const T = getTheme(isDark);

    if (my < PRICE_H) {
      ctx.strokeStyle = T.crosshair; ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, PRICE_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(W, my);       ctx.stroke();
      ctx.setLineDash([]);
      const price = minP + (1 - my / PRICE_H) * (maxP - minP);
      const pl = fmtP(price); ctx.font = '10px ui-monospace,monospace';
      const tw = ctx.measureText(pl).width;
      ctx.fillStyle = T.labelBg; ctx.beginPath(); ctx.roundRect(W - tw - 16, my - 9, tw + 12, 17, 3); ctx.fill();
      ctx.fillStyle = T.text1; ctx.textAlign = 'right'; ctx.fillText(pl, W - 6, my + 4);
    }

    const ts  = minT + (mx / W) * (maxT - minT);
    const dl  = new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
    ctx.font  = '9px ui-monospace,monospace';
    const tw2 = ctx.measureText(dl).width;
    ctx.fillStyle = T.labelBg; ctx.beginPath(); ctx.roundRect(mx - tw2 / 2 - 5, PRICE_H - 18, tw2 + 10, 14, 3); ctx.fill();
    ctx.fillStyle = T.text1; ctx.textAlign = 'center'; ctx.fillText(dl, mx, PRICE_H - 7);

    ctx.strokeStyle = T.crosshair; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, PRICE_H + 2); ctx.lineTo(mx, PRICE_H + 2 + LIQ_H); ctx.stroke();
    ctx.setLineDash([]);

    const col    = Math.min(Math.max(Math.floor(mx / cellW), 0), COLS - 1);
    const candle = candles[col]; if (!candle) return;

    const inLiqPanel  = my > PRICE_H + 2;
    const cursorPrice = inLiqPanel ? minP + (mx / W) * (maxP - minP) : minP + (1 - my / PRICE_H) * (maxP - minP);
    const { cumLong, cumShort, buckets, bucketW } = metaRef.current;
    let liqLong = 0, liqShort = 0;
    if (buckets.length > 0 && bucketW > 0) {
      const bi = Math.floor((cursorPrice - minP) / bucketW);
      if (bi >= 0 && bi < buckets.length) { liqLong = buckets[bi].long; liqShort = buckets[bi].short; }
    }
    setTooltip({ clientX: e.clientX, clientY: e.clientY, date: dl,
      o: parseFloat(candle.o).toFixed(1), h: parseFloat(candle.h).toFixed(1),
      l: parseFloat(candle.l).toFixed(1), c: parseFloat(candle.c).toFixed(1),
      liqLong, liqShort, inLiqPanel, panelPrice: fmtP(cursorPrice), cumLong, cumShort });
  }, [redraw]);

  const onMouseLeave = useCallback(() => {
    setTooltip(null); dragRef.current.dragging = false;
    overlayRef.current?.getContext('2d')?.clearRect(0, 0, 9999, 9999);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const z = zoomRef.current, delta = e.deltaY > 0 ? 1.15 : 0.87;
    const newZoom = Math.max(0.05, Math.min(1.0, z.zoom * delta));
    const total   = allCandlesRef.current.length;
    z.zoom = newZoom; z.offset = Math.max(0, Math.min(total - Math.round(total * newZoom), z.offset));
    redraw();
  }, [redraw]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startOffset: zoomRef.current.offset };
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current.dragging = false; }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  /* ── UI tokens ─────────────────────────────────────────── */
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const T      = getTheme(isDark);

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="flex flex-col rounded-2xl overflow-hidden"
        style={{ width: 980, maxWidth: '96vw', background: T.bgModal, border: `1px solid ${T.border}`, boxShadow: T.modalShadow }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${T.border}`, background: T.bgHeader }}>
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={symbol} size={22} />
            <span className="text-[15px] font-bold" style={{ color: T.text1 }}>Liquidation Leverage Map</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded"
              style={{ background: T.accentTealBg, color: T.accentTeal }}>{coin}</span>
          </div>
          <div className="flex items-center gap-3">
            {stats.price > 0 && (
              <span className="font-mono text-[13px] font-bold px-3 py-1 rounded-lg"
                style={{ background: T.priceBadgeBg, color: T.priceBadgeText, boxShadow: T.priceBadgeGlow }}>
                {fmtP(stats.price)}
              </span>
            )}
            <div className="flex items-center gap-1 text-[11px]">
              <span className="w-2 h-2 rounded-sm" style={{ background: T.longColor }} />
              <span style={{ color: T.longColor }}>Long {fmtU(stats.totalLong)}</span>
            </div>
            <div className="flex items-center gap-1 text-[11px]">
              <span className="w-2 h-2 rounded-sm" style={{ background: T.shortColor }} />
              <span style={{ color: T.shortColor }}>Short {fmtU(stats.totalShort)}</span>
            </div>
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[14px] hover:opacity-60 transition-opacity"
              style={{ color: T.text2, background: T.btnBg }}>✕</button>
          </div>
        </div>

        {/* Range + legend */}
        <div className="flex items-center gap-4 px-5 py-2"
          style={{ borderBottom: `1px solid ${T.border}`, background: T.bgHeader }}>
          <span className="text-[10px] uppercase font-semibold tracking-widest" style={{ color: T.text3 }}>Range</span>
          <div className="flex gap-0.5 p-0.5 rounded-lg"
            style={{ background: T.rangeInner, border: `1px solid ${T.border}` }}>
            {RANGES.map((r, i) => (
              <button key={r.label} onClick={() => setRangeIdx(i)}
                className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all"
                style={{
                  background: rangeIdx === i ? T.btnActiveBg  : 'transparent',
                  color:      rangeIdx === i ? T.btnActiveColor : T.text2,
                  boxShadow:  rangeIdx === i ? T.btnActiveShadow : 'none',
                }}>{r.label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-[9px]" style={{ color: T.text2 }}>
            <span>Price chart <span style={{ color: T.priceStroke }}>●</span></span>
            <span>Mark price <span style={{ color: T.markBg }}>- -</span></span>
            <span>Long liq <span style={{ color: T.longLine }}>█</span></span>
            <span>Short liq <span style={{ color: T.shortLine }}>█</span></span>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative" style={{ height: 440 }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: T.bgModal }}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mb-3"
                style={{ borderColor: T.spinBorder, borderTopColor: T.spinTop }} />
              <span className="text-[12px]" style={{ color: T.text2 }}>Loading {coin}...</span>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <span className="text-3xl">⚠️</span>
              <span className="text-[12px]" style={{ color: isDark ? '#f87171' : '#dc2626' }}>{error}</span>
              <button onClick={() => setRangeIdx(i => i)} className="text-[11px] px-4 py-1.5 rounded-lg"
                style={{ background: T.btnActiveBg, color: T.btnActiveColor, border: `1px solid ${T.border}` }}>
                Retry
              </button>
            </div>
          )}
          <canvas ref={canvasRef}  width={980} height={440} className="absolute inset-0 w-full h-full" />
          <canvas ref={overlayRef} width={980} height={440} className="absolute inset-0 w-full h-full cursor-crosshair"
            onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}
            onWheel={onWheel} onMouseDown={onMouseDown} onMouseUp={onMouseUp} />

          {tooltip && (
            <div className="fixed pointer-events-none rounded-xl z-[9999]"
              style={{
                left: tooltip.clientX + 18, top: Math.max(tooltip.clientY - 90, 10),
                background: T.tooltipBg, border: `1px solid ${T.border}`,
                padding: '10px 14px', minWidth: 220,
                boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 24px rgba(0,0,0,0.14)',
                transform: tooltip.clientX > window.innerWidth - 280 ? 'translateX(-100%) translateX(-36px)' : 'none',
              }}>
              {tooltip.inLiqPanel ? (
                <>
                  <div className="font-mono text-[12px] font-bold mb-2" style={{ color: T.text1 }}>{tooltip.panelPrice}</div>
                  <div className="space-y-1.5 text-[11px]">
                    {([
                      ['Liq leverage', fmtU(tooltip.liqLong + tooltip.liqShort), T.accentTeal],
                      ['Cumulative long liq',  fmtU(tooltip.cumLong),  T.longColor],
                      ['Cumulative short liq', fmtU(tooltip.cumShort), T.shortColor],
                    ] as [string, string, string][]).map(([k, v, c]) => (
                      <div key={k} className="flex items-center justify-between gap-5">
                        <span style={{ color: T.text2 }}>{k}</span>
                        <span className="font-mono font-bold" style={{ color: c }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-mono text-[9px] mb-2 font-semibold" style={{ color: T.text2 }}>{tooltip.date}</div>
                  <div className="space-y-1 text-[11px]">
                    {([
                      ['Open',  tooltip.o, T.text2],
                      ['High',  tooltip.h, T.longColor],
                      ['Low',   tooltip.l, T.shortColor],
                      ['Close', tooltip.c, T.text1],
                    ] as [string, string, string][]).map(([k, v, c]) => (
                      <div key={k} className="flex items-center justify-between gap-4">
                        <span style={{ color: T.text2 }}>{k}</span>
                        <span className="font-mono font-semibold" style={{ color: c }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* X-axis */}
        <div className="flex justify-between px-3 py-1.5"
          style={{ borderTop: `1px solid ${T.border}`, background: T.xAxisBg }}>
          {Array.from({ length: 8 }, (_, i) => {
            const { minT, maxT } = metaRef.current;
            const ts = minT && maxT ? minT + (i / 7) * (maxT - minT) : 0;
            return (
              <span key={i} className="text-[9px] font-mono" style={{ color: T.text2 }}>
                {ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '') : '—'}
              </span>
            );
          })}
        </div>

      </div>
    </div>
  );
}
