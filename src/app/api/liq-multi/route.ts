/**
 * GET /api/liq-multi?hours=24
 * Liquidation data: HyperLiquid (OI+funding) + Pacifica (real trades)
 * Sadece Pacifica'da listelenen semboller döner.
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

// Pacifica fallback market listesi
const PACIFICA_FALLBACK = new Set([
  'BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','LINK','DOT',
  'BNB','LTC','BCH','UNI','ATOM','NEAR','APT','ARB','OP',
  'SUI','TRX','HYPE','PEPE','WIF','JUP','SEI','INJ','TIA',
  'WLD','BLUR','PENDLE','GMX','DYDX','RUNE','RNDR','FET',
  'MATIC','TON','BONK','PYTH','W','ALT','STRK','ZEC','ASTER',
  'LIT','PAXG','ZRO','VIRTUAL','FARTCOIN','AI16Z','TRUMP',
]);

async function fetchPacificaSymbols(): Promise<Set<string>> {
  try {
    const res = await fetch('https://api.pacifica.fi/api/v1/info', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return PACIFICA_FALLBACK;
    const json = await res.json();
    const markets: { symbol?: string }[] = json?.data ?? json ?? [];
    const set = new Set<string>();
    for (const m of markets) {
      if (m.symbol) set.add(m.symbol.replace(/-USD$/i, '').toUpperCase());
    }
    return set.size > 5 ? set : PACIFICA_FALLBACK;
  } catch { return PACIFICA_FALLBACK; }
}

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
      const coin = String(meta.universe[i]?.name ?? '').toUpperCase();
      const ctx  = ctxs[i];
      if (!coin || !ctx || !allowed.has(coin)) continue;

      const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
      const markPrice = parseFloat(String(ctx.markPx ?? '0'));
      const dayVol    = parseFloat(String(ctx.dayNtlVlm ?? '0'));
      if (!markPrice || openInt <= 0 || dayVol < 1000) continue;

      const funding   = parseFloat(String(ctx.funding ?? '0'));
      const liqRate   = Math.min(Math.max(Math.abs(funding) * 600 + 0.0015, 0.0015), 0.01);
      const totalLiq  = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
      if (totalLiq < 200) continue;

      const longBias  = funding > 0 ? 0.65 : 0.35;
      const slices    = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = Date.now() - (h / slices) * hours * 3600 * 1000;
        const slice = totalLiq / slices;
        events.push({ id: `hl-${coin}-L-${h}`, symbol: coin, side: 'long',  price: markPrice, notional: slice * longBias,       ts });
        events.push({ id: `hl-${coin}-S-${h}`, symbol: coin, side: 'short', price: markPrice, notional: slice * (1 - longBias), ts });
      }
    }
  } catch (e) { console.error('[liq-multi] HL:', e); }
  return events;
}

async function fetchPacificaLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  const symbols = Array.from(allowed).slice(0, 30);
  await Promise.all(symbols.map(async (coin) => {
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
          id:       `pac-${coin}-${ts}`,
          symbol:   coin,
          side:     (t.side ?? '').includes('long') ? 'long' : 'short',
          price, notional, ts,
        });
      }
    } catch { /* per-symbol ignore */ }
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
  return Array.from(map.values()).filter(s => s.total > 50).sort((a, b) => b.total - a.total);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  try {
    const pacificaSymbols = await fetchPacificaSymbols();
    const [hlEvents, pacEvents] = await Promise.all([
      fetchHyperliquidLiqs(hours, pacificaSymbols),
      fetchPacificaLiqs(hours, pacificaSymbols),
    ]);
    const allEvents = [...hlEvents, ...pacEvents];
    const summary   = buildSummary(allEvents);
    const recent    = [...allEvents].sort((a, b) => b.ts - a.ts).slice(0, 300);
    return NextResponse.json({
      summary, recent,
      pacificaSymbols: Array.from(pacificaSymbols),
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
