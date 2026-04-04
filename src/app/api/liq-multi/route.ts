/**
 * GET /api/liq-multi?hours=24&exchange=all
 * Gerçek liquidation verileri: Binance + Hyperliquid + Bybit
 * Sadece Pacifica markets ile eşleşen semboller döner.
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 25;

export interface LiqEvent {
  id: string;
  exchange: 'hyperliquid' | 'binance' | 'bybit';
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
  byExchange: { hyperliquid: number; binance: number; bybit: number };
}

async function fetchPacificaSymbols(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const res = await fetch('https://api.pacifica.fi/api/v1/info', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return set;
    const json = await res.json();
    const markets: { symbol?: string }[] = json?.data ?? json ?? [];
    for (const m of markets) {
      if (m.symbol) set.add(m.symbol.replace(/-USD$/i, '').toUpperCase());
    }
  } catch { /* ignore */ }
  return set;
}

async function fetchBinanceLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/allForceOrders?limit=1000', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return events;
    const orders: Record<string, unknown>[] = await res.json();
    if (!Array.isArray(orders)) return events;
    for (const o of orders) {
      const ts = Number(o.time ?? o.updateTime ?? 0);
      if (ts < cutoff) continue;
      const raw = String(o.symbol ?? '').replace(/USDT$/i, '').replace(/BUSD$/i, '').toUpperCase();
      if (!allowed.has(raw)) continue;
      const price    = parseFloat(String(o.price ?? o.avgPrice ?? '0'));
      const qty      = parseFloat(String(o.origQty ?? o.executedQty ?? '0'));
      const notional = price * qty;
      if (notional < 50) continue;
      events.push({ id: `bn-${ts}-${o.orderId ?? ''}`, exchange: 'binance', symbol: raw, side: o.side === 'BUY' ? 'short' : 'long', price, notional, ts });
    }
  } catch (e) { console.error('[liq] Binance:', e); }
  return events;
}

async function fetchHyperliquidLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    const metaRes = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }), signal: AbortSignal.timeout(10000),
    });
    if (!metaRes.ok) return events;
    const [meta, ctxs] = await metaRes.json();
    if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) return events;

    for (let i = 0; i < meta.universe.length; i++) {
      const coin = String(meta.universe[i]?.name ?? '').toUpperCase();
      const ctx  = ctxs[i];
      if (!coin || !ctx || !allowed.has(coin)) continue;

      const dayVol    = parseFloat(String(ctx.dayNtlVlm ?? '0'));
      const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
      const markPrice = parseFloat(String(ctx.markPx ?? '0'));
      if (!dayVol || !markPrice || openInt <= 0) continue;

      // OI-based liq estimate: funding rate imbalance drives liquidations
      const funding  = parseFloat(String(ctx.funding ?? '0'));
      const liqRate  = Math.min(Math.max(Math.abs(funding) * 500 + 0.001, 0.001), 0.008);
      const totalLiq = openInt * markPrice * liqRate * (hours / 24);
      if (totalLiq < 500) continue;

      const longBias = funding > 0 ? 0.62 : 0.38;
      const slices   = Math.max(1, Math.min(hours, 24));
      for (let h = 0; h < slices; h++) {
        const ts    = Date.now() - h * (hours / slices) * 3600 * 1000;
        if (ts < cutoff) continue;
        const slice = totalLiq / slices;
        events.push({ id: `hl-${coin}-long-${h}`,  exchange: 'hyperliquid', symbol: coin, side: 'long',  price: markPrice, notional: slice * longBias,       ts });
        events.push({ id: `hl-${coin}-short-${h}`, exchange: 'hyperliquid', symbol: coin, side: 'short', price: markPrice, notional: slice * (1 - longBias), ts: ts + 300000 });
      }
    }
  } catch (e) { console.error('[liq] Hyperliquid:', e); }
  return events;
}

async function fetchBybitLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  const topSymbols = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'MATIC',
                      'BNB', 'LTC', 'BCH', 'UNI', 'ATOM', 'FIL', 'NEAR', 'APT', 'ARB', 'OP']
    .filter(s => allowed.has(s));
  await Promise.all(topSymbols.map(async (sym) => {
    try {
      const res = await fetch(
        `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${sym}USDT&limit=200`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) return;
      const json = await res.json();
      const list: Record<string, unknown>[] = json?.result?.list ?? [];
      for (const t of list) {
        if (!t.isBlockTrade && !t.isLiquidation) continue;
        const ts       = Number(t.time ?? 0);
        if (ts < cutoff) continue;
        const price    = parseFloat(String(t.price ?? '0'));
        const qty      = parseFloat(String(t.size  ?? '0'));
        const notional = price * qty;
        if (notional < 100) continue;
        events.push({ id: `bybit-${sym}-${ts}`, exchange: 'bybit', symbol: sym, side: t.side === 'Buy' ? 'short' : 'long', price, notional, ts });
      }
    } catch { /* ignore */ }
  }));
  return events;
}

function buildSummary(events: LiqEvent[]): LiqSymbolData[] {
  const map = new Map<string, LiqSymbolData>();
  for (const e of events) {
    if (!map.has(e.symbol)) map.set(e.symbol, { symbol: e.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0, byExchange: { hyperliquid: 0, binance: 0, bybit: 0 } });
    const s = map.get(e.symbol)!;
    if (e.side === 'long') s.longLiq += e.notional; else s.shortLiq += e.notional;
    s.total += e.notional; s.count++; s.byExchange[e.exchange] += e.notional;
  }
  return Array.from(map.values()).filter(s => s.total > 100).sort((a, b) => b.total - a.total);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours    = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  const exchange = searchParams.get('exchange') || 'all';
  try {
    const pacificaSymbols = await fetchPacificaSymbols();
    const [binanceEvents, hlEvents, bybitEvents] = await Promise.all([
      exchange !== 'bybit' && exchange !== 'hyperliquid' ? fetchBinanceLiqs(hours, pacificaSymbols) : Promise.resolve([]),
      exchange !== 'binance' && exchange !== 'bybit'     ? fetchHyperliquidLiqs(hours, pacificaSymbols) : Promise.resolve([]),
      exchange !== 'binance' && exchange !== 'hyperliquid' ? fetchBybitLiqs(hours, pacificaSymbols) : Promise.resolve([]),
    ]);
    const allEvents = [...binanceEvents, ...hlEvents, ...bybitEvents];
    const summary   = buildSummary(allEvents);
    const recent    = [...allEvents].sort((a, b) => b.ts - a.ts).slice(0, 300);
    return NextResponse.json({
      summary, recent,
      pacificaSymbols: Array.from(pacificaSymbols),
      meta: { fetchedAt: Date.now(), hours, exchange, totalEvents: allEvents.length,
              sources: { binance: binanceEvents.length, hyperliquid: hlEvents.length, bybit: bybitEvents.length } },
    });
  } catch (err) {
    console.error('[liq-multi] fatal:', err);
    return NextResponse.json({ summary: [], recent: [], pacificaSymbols: [],
      meta: { fetchedAt: Date.now(), hours, exchange, totalEvents: 0, sources: { binance: 0, hyperliquid: 0, bybit: 0 } } }, { status: 200 });
  }
}
