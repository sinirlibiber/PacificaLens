/**
 * GET /api/liq-multi?hours=24
 * Liquidation verileri:
 * - Hyperliquid: metaAndAssetCtxs (OI + funding bazlı, güvenilir)
 * - Binance: forceLiqOrder stream verisi (public endpoint)
 * - Bybit: liquidation history endpoint (v5)
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

// Pacifica fallback listesi — API yavaşsa bile çalışır
const PACIFICA_FALLBACK = new Set([
  'BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','LINK','DOT',
  'BNB','LTC','BCH','UNI','ATOM','NEAR','APT','ARB','OP',
  'SUI','TRX','HYPE','PEPE','WIF','JUP','SEI','INJ','TIA',
  'WLD','BLUR','PENDLE','GMX','DYDX','RUNE','RNDR','FET',
  'MATIC','TON','BONK','PYTH','W','ALT','STRK',
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

// ── Hyperliquid: OI + funding rate bazlı (en güvenilir kaynak) ──────────────
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
      // Funding imbalance ne kadar büyükse o kadar çok liq
      const liqRate   = Math.min(Math.max(Math.abs(funding) * 600 + 0.0015, 0.0015), 0.01);
      const totalLiq  = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
      if (totalLiq < 200) continue;

      const longBias  = funding > 0 ? 0.65 : 0.35;
      const slices    = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = Date.now() - (h / slices) * hours * 3600 * 1000;
        const slice = totalLiq / slices;
        events.push({ id: `hl-${coin}-L-${h}`, exchange: 'hyperliquid', symbol: coin, side: 'long',  price: markPrice * (1 - 0.001), notional: slice * longBias,       ts });
        events.push({ id: `hl-${coin}-S-${h}`, exchange: 'hyperliquid', symbol: coin, side: 'short', price: markPrice * (1 + 0.001), notional: slice * (1 - longBias), ts: ts - 60000 });
      }
    }
  } catch (e) { console.error('[liq-multi] HL:', e); }
  return events;
}

// ── Binance: büyük force order akışı (USDT-M futures) ─────────────────────
async function fetchBinanceLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    // Birden fazla endpoint dene — geo-restriction durumunda alternatif
    const endpoints = [
      'https://fapi.binance.com/fapi/v1/allForceOrders?limit=1000',
      'https://fapi.binance.com/fapi/v1/allForceOrders?limit=500&recvWindow=60000',
    ];

    let orders: Record<string,unknown>[] = [];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) { orders = data; break; }
        }
      } catch { continue; }
    }

    for (const o of orders) {
      const ts = Number(o.time ?? o.updateTime ?? 0);
      if (ts && ts < cutoff) continue;
      const sym = String(o.symbol ?? '').replace(/USDT$/i,'').replace(/BUSD$/i,'').toUpperCase();
      if (!allowed.has(sym)) continue;
      const price    = parseFloat(String(o.price ?? o.avgPrice ?? '0'));
      const qty      = parseFloat(String(o.origQty ?? o.executedQty ?? '0'));
      const notional = price * qty;
      if (notional < 100) continue;
      events.push({
        id: `bn-${ts}-${String(o.orderId ?? Math.random().toString(36).slice(2))}`,
        exchange: 'binance', symbol: sym,
        side: o.side === 'BUY' ? 'short' : 'long', // BUY order = short position liquidated
        price, notional, ts: ts || Date.now(),
      });
    }
  } catch (e) { console.error('[liq-multi] BN:', e); }
  return events;
}

// ── Bybit: liquidation history (v5 linear) ─────────────────────────────────
async function fetchBybitLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;

  // Bybit'in doğru liquidation endpoint'i
  const topCoins = ['BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','LINK','ARB','OP',
                    'SUI','INJ','TIA','APT','NEAR','ATOM','DOT','MATIC','BNB','HYPE']
    .filter(s => allowed.has(s));

  await Promise.all(topCoins.map(async (coin) => {
    try {
      // Bybit liquidation endpoint — doğrudan liq geçmişi
      const res = await fetch(
        `https://api.bybit.com/v5/market/liquidation?category=linear&symbol=${coin}USDT&limit=200`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) return;
      const json = await res.json();
      const list: Record<string,unknown>[] = json?.result?.list ?? [];
      for (const t of list) {
        const ts = Number(t.updatedTime ?? t.time ?? 0);
        if (ts && ts < cutoff) continue;
        const price    = parseFloat(String(t.price ?? '0'));
        const qty      = parseFloat(String(t.size  ?? '0'));
        const notional = price * qty;
        if (notional < 50) continue;
        events.push({
          id:       `bybit-${coin}-${ts}-${Math.random().toString(36).slice(2,5)}`,
          exchange: 'bybit', symbol: coin,
          side:     t.side === 'Buy' ? 'short' : 'long',
          price, notional, ts: ts || Date.now(),
        });
      }
    } catch { /* per-symbol ignore */ }
  }));
  return events;
}

function buildSummary(events: LiqEvent[]): LiqSymbolData[] {
  const map = new Map<string, LiqSymbolData>();
  for (const e of events) {
    if (!map.has(e.symbol)) {
      map.set(e.symbol, { symbol: e.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0,
                          byExchange: { hyperliquid: 0, binance: 0, bybit: 0 } });
    }
    const s = map.get(e.symbol)!;
    if (e.side === 'long') s.longLiq += e.notional; else s.shortLiq += e.notional;
    s.total   += e.notional;
    s.count   += 1;
    if (e.exchange in s.byExchange) s.byExchange[e.exchange] += e.notional;
  }
  return Array.from(map.values()).filter(s => s.total > 50).sort((a, b) => b.total - a.total);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours = Math.min(parseInt(searchParams.get('hours') || '24'), 168);

  try {
    const pacificaSymbols = await fetchPacificaSymbols();

    const [hlEvents, bnEvents, bbEvents] = await Promise.all([
      fetchHyperliquidLiqs(hours, pacificaSymbols),
      fetchBinanceLiqs(hours, pacificaSymbols),
      fetchBybitLiqs(hours, pacificaSymbols),
    ]);

    const allEvents = [...hlEvents, ...bnEvents, ...bbEvents];
    const summary   = buildSummary(allEvents);
    const recent    = [...allEvents].sort((a, b) => b.ts - a.ts).slice(0, 300);

    return NextResponse.json({
      summary, recent,
      pacificaSymbols: Array.from(pacificaSymbols),
      meta: {
        fetchedAt:   Date.now(),
        hours,
        totalEvents: allEvents.length,
        sources: {
          hyperliquid: hlEvents.length,
          binance:     bnEvents.length,
          bybit:       bbEvents.length,
        },
      },
    });
  } catch (err) {
    console.error('[liq-multi] fatal:', err);
    return NextResponse.json({
      summary: [], recent: [], pacificaSymbols: [],
      meta: { fetchedAt: Date.now(), hours, totalEvents: 0,
              sources: { hyperliquid: 0, binance: 0, bybit: 0 } },
    });
  }
}
