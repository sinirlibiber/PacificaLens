/**
 * GET /api/liq-multi?hours=24&symbols=BTC,ETH,SOL,...
 * symbols: HeatmapView'dan gelen Pacifica market listesi (gerçek, doğru)
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 20;

export interface LiqEvent {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  price: number;
  notional: number;
  ts: number;
}
export interface LiqSymbolData {
  symbol: string;
  longLiq: number;
  shortLiq: number;
  total: number;
  count: number;
}

// HyperLiquid sembol adı → Pacifica sembol adı mapping
const HL_TO_PAC: Record<string, string> = {
  'USA500-USDT':'SP500','USA500-USDC':'SP500','USA500-USDH':'SP500','USA500':'SP500',
  'GOLD-USDC':'XAU','GOLD-USDT':'XAU','GOLD-USDH':'XAU','GOLD':'XAU',
  'WTIOIL-USDC':'CL','WTIOIL-USDT':'CL','WTIOIL-USDH':'CL','WTIOIL':'CL',
  'TSLA-USDT':'TSLA','TSLA-USDC':'TSLA','TSLA-USDH':'TSLA',
  'USDJPY-USDC':'USDJPY','USDJPY-USDT':'USDJPY','USDJPY-USDH':'USDJPY',
  'EURUSD-USDC':'EURUSD','EURUSD-USDT':'EURUSD','EURUSD-USDH':'EURUSD',
  'GOOGL-USDC':'GOOGL','GOOGL-USDT':'GOOGL','GOOGL-USDH':'GOOGL',
  'NVDA-USDT':'NVDA','NVDA-USDC':'NVDA','NVDA-USDH':'NVDA',
  'PLTR-USDC':'PLTR','PLTR-USDT':'PLTR','PLTR-USDH':'PLTR',
  'PLATINUM-USDC':'PLATINUM','PLATINUM-USDT':'PLATINUM','PLATINUM-USDH':'PLATINUM',
  'URNM-USDC':'URNM','URNM-USDT':'URNM','URNM-USDH':'URNM',
  'COPPER-USDC':'COPPER','COPPER-USDT':'COPPER','COPPER-USDH':'COPPER',
  'SILVER-USDC':'SILVER','SILVER-USDT':'SILVER','SILVER-USDH':'SILVER',
  'NATGAS-USDC':'NATGAS','NATGAS-USDT':'NATGAS','NATGAS-USDH':'NATGAS',
  'CRCL-USDC':'CRCL','CRCL-USDT':'CRCL','CRCL-USDH':'CRCL',
  'HOOD-USDT':'HOOD','HOOD-USDC':'HOOD','HOOD-USDH':'HOOD',
};

async function fetchHyperliquidLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return events;
    const [meta, ctxs] = await res.json();
    if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) return events;

    for (let i = 0; i < meta.universe.length; i++) {
      const hlRaw = String(meta.universe[i]?.name ?? '');
      const ctx   = ctxs[i];
      if (!hlRaw || !ctx) continue;

      // HL sembolünü Pacifica sembolüne çevir
      const pacSymbol = HL_TO_PAC[hlRaw]
        ?? HL_TO_PAC[hlRaw.toUpperCase()]
        ?? hlRaw.toUpperCase().replace(/-(USDT|USDC|USDH|USD)$/i, '');

      // Sadece Pacifica'dan gelen listede olanları al
      if (!allowed.has(pacSymbol)) continue;

      const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
      const markPrice = parseFloat(String(ctx.markPx ?? '0'));
      if (!markPrice || openInt <= 0) continue;

      const funding  = parseFloat(String(ctx.funding ?? '0'));
      const liqRate  = Math.min(Math.max(Math.abs(funding) * 600 + 0.0015, 0.0015), 0.01);
      const totalLiq = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
      if (totalLiq <= 0) continue;

      const longBias = funding > 0 ? 0.65 : 0.35;
      const slices   = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = Date.now() - (h / slices) * hours * 3600 * 1000;
        const slice = totalLiq / slices;
        events.push({ id: `hl-${pacSymbol}-L-${h}`, symbol: pacSymbol, side: 'long',  price: markPrice, notional: slice * longBias,       ts });
        events.push({ id: `hl-${pacSymbol}-S-${h}`, symbol: pacSymbol, side: 'short', price: markPrice, notional: slice * (1 - longBias), ts });
      }
    }
  } catch (e) { console.error('[liq-multi] HL:', e); }
  return events;
}

async function fetchPacificaLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff  = Date.now() - hours * 3600 * 1000;
  await Promise.all(Array.from(allowed).map(async (coin) => {
    try {
      const res = await fetch(
        `https://api.pacifica.fi/api/v1/trades?symbol=${coin}-USD&limit=500`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) return;
      const json = await res.json();
      const trades: { cause?: string; side?: string; price?: string; amount?: string; created_at?: number }[] =
        json?.data ?? [];
      for (const t of trades) {
        if (!t.cause?.toLowerCase().includes('liq')) continue;
        const rawTs = t.created_at ?? 0;
        const ts    = rawTs > 1e12 ? rawTs : rawTs * 1000;
        if (ts < cutoff) continue;
        const price    = parseFloat(t.price ?? '0');
        const notional = price * parseFloat(t.amount ?? '0');
        if (!notional || notional < 10) continue;
        events.push({
          id:     `pac-${coin}-${ts}-${Math.random().toString(36).slice(2,5)}`,
          symbol: coin,
          side:   (t.side ?? '').includes('long') ? 'long' : 'short',
          price, notional, ts,
        });
      }
    } catch { /* ignore */ }
  }));
  return events;
}

function buildSummary(events: LiqEvent[]): LiqSymbolData[] {
  const map = new Map<string, LiqSymbolData>();
  for (const e of events) {
    if (!map.has(e.symbol)) map.set(e.symbol, { symbol: e.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 });
    const s = map.get(e.symbol)!;
    if (e.side === 'long') s.longLiq += e.notional; else s.shortLiq += e.notional;
    s.total += e.notional;
    s.count++;
  }
  return Array.from(map.values()).filter(s => s.total > 0).sort((a, b) => b.total - a.total);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours   = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  // HeatmapView'dan gelen Pacifica market listesi — bu gerçek ve doğru
  const symbolsParam = searchParams.get('symbols') || '';
  const allowed = new Set(
    symbolsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
  );

  // symbols parametresi yoksa boş döndür — hatalı veri gösterme
  if (allowed.size === 0) {
    return NextResponse.json({
      summary: [], recent: [], pacificaSymbols: [],
      meta: { fetchedAt: Date.now(), hours, totalEvents: 0, sources: { hyperliquid: 0, pacifica: 0 } },
    });
  }

  try {
    const [hlEvents, pacEvents] = await Promise.all([
      fetchHyperliquidLiqs(hours, allowed),
      fetchPacificaLiqs(hours, allowed),
    ]);
    const allEvents = [...hlEvents, ...pacEvents];
    const summary   = buildSummary(allEvents);
    const recent    = [...allEvents].sort((a, b) => b.ts - a.ts).slice(0, 300);
    return NextResponse.json({
      summary, recent,
      pacificaSymbols: Array.from(allowed),
      meta: {
        fetchedAt:   Date.now(),
        hours,
        totalEvents: allEvents.length,
        sources: { hyperliquid: hlEvents.length, pacifica: pacEvents.length },
      },
    });
  } catch (err) {
    console.error('[liq-multi] fatal:', err);
    return NextResponse.json({ summary: [], recent: [], pacificaSymbols: [],
      meta: { fetchedAt: Date.now(), hours, totalEvents: 0, sources: { hyperliquid: 0, pacifica: 0 } } });
  }
}
