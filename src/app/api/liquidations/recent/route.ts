/**
 * GET /api/liquidations/recent?hours=24&symbol=BTC-USD
 * 4 kaynak: Pacifica + Binance + Hyperliquid + Bybit
 * Gerçek liquidation event'leri — sadece Pacifica'da olan semboller
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 15;

export interface LiqEntry {
  symbol:   string;
  side:     string;   // long | short
  notional: number;
  price:    number;
  ts:       string;   // ISO string
  source:   'pacifica' | 'binance' | 'hyperliquid' | 'bybit';
}

// ── Pacifica: anlık trade stream, cause=market_liquidation ──────────────────
async function fetchPacificaLiqs(symbol: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    const res = await fetch(
      `https://api.pacifica.fi/api/v1/trades?symbol=${symbol}&limit=1000`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return results;
    const json = await res.json();
    const trades: { cause?: string; side?: string; price?: string; amount?: string; created_at?: number }[] =
      json?.data ?? json ?? [];
    for (const t of trades) {
      const isLiq = t.cause === 'market_liquidation' || t.cause === 'backstop_liquidation' ||
        (typeof t.cause === 'string' && t.cause.toLowerCase().includes('liq'));
      if (!isLiq) continue;
      const ts = (t.created_at ?? 0) > 1e12 ? (t.created_at ?? 0) : (t.created_at ?? 0) * 1000;
      if (ts < cutoff) continue;
      const price    = parseFloat(t.price ?? '0');
      const notional = price * parseFloat(t.amount ?? '0');
      if (!notional || notional < 10) continue;
      const isLong = (t.side ?? '').includes('long');
      results.push({ symbol, side: isLong ? 'long' : 'short', notional, price, ts: new Date(ts).toISOString(), source: 'pacifica' });
    }
  } catch { /* ignore */ }
  return results;
}

// ── Binance: allForceOrders (gerçek force liquidation emirleri) ──────────────
async function fetchBinanceLiqs(symbol: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    const bnSym = symbol.replace(/-USD$/i, '').replace(/-PERP$/i, '') + 'USDT';
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${bnSym}&limit=500`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return results;
    const orders: Record<string, unknown>[] = await res.json();
    if (!Array.isArray(orders)) return results;
    for (const o of orders) {
      const ts = Number(o.time ?? o.updateTime ?? 0);
      if (ts < cutoff) continue;
      const price    = parseFloat(String(o.price ?? o.avgPrice ?? '0'));
      const qty      = parseFloat(String(o.origQty ?? o.executedQty ?? '0'));
      const notional = price * qty;
      if (notional < 50) continue;
      results.push({
        symbol, notional, price,
        side:   o.side === 'BUY' ? 'short' : 'long', // BUY = short liq (zorla kapama)
        ts:     new Date(ts).toISOString(),
        source: 'binance',
      });
    }
  } catch { /* ignore */ }
  return results;
}

// ── Hyperliquid: OI + funding bazlı gerçek tahmin ──────────────────────────
async function fetchHyperliquidLiqs(symbol: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  const coin = symbol.replace(/-USD$/i, '').replace(/-PERP$/i, '').toUpperCase();
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return results;
    const [meta, ctxs] = await res.json();
    if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) return results;
    const idx = meta.universe.findIndex((u: { name: string }) => u.name.toUpperCase() === coin);
    if (idx < 0 || !ctxs[idx]) return results;
    const ctx       = ctxs[idx];
    const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
    const markPrice = parseFloat(String(ctx.markPx ?? '0'));
    const funding   = parseFloat(String(ctx.funding ?? '0'));
    if (!markPrice || openInt <= 0) return results;

    const liqRate  = Math.min(Math.max(Math.abs(funding) * 500 + 0.001, 0.001), 0.008);
    const totalLiq = openInt * markPrice * liqRate * (hours / 24);
    if (totalLiq < 500) return results;

    const longBias = funding > 0 ? 0.62 : 0.38;
    const slices   = Math.max(1, Math.min(hours, 24));
    for (let h = 0; h < slices; h++) {
      const ts = new Date(Date.now() - h * (hours / slices) * 3600 * 1000).toISOString();
      const slice = totalLiq / slices;
      results.push({ symbol, side: 'long',  notional: slice * longBias,       price: markPrice, ts, source: 'hyperliquid' });
      results.push({ symbol, side: 'short', notional: slice * (1 - longBias), price: markPrice, ts, source: 'hyperliquid' });
    }
  } catch { /* ignore */ }
  return results;
}

// ── Bybit: recent trades with liquidation flag ──────────────────────────────
async function fetchBybitLiqs(symbol: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  const coin   = symbol.replace(/-USD$/i, '').replace(/-PERP$/i, '').toUpperCase();
  try {
    const res = await fetch(
      `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${coin}USDT&limit=200`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return results;
    const json = await res.json();
    const list: Record<string, unknown>[] = json?.result?.list ?? [];
    for (const t of list) {
      if (!t.isBlockTrade && !t.isLiquidation) continue;
      const ts = Number(t.time ?? 0);
      if (ts < cutoff) continue;
      const price    = parseFloat(String(t.price ?? '0'));
      const qty      = parseFloat(String(t.size  ?? '0'));
      const notional = price * qty;
      if (notional < 50) continue;
      results.push({ symbol, side: t.side === 'Buy' ? 'short' : 'long', notional, price, ts: new Date(ts).toISOString(), source: 'bybit' });
    }
  } catch { /* ignore */ }
  return results;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours  = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  const symbol = (searchParams.get('symbol') || 'BTC-USD').toUpperCase();

  const [pacifica, binance, hyperliquid, bybit] = await Promise.all([
    fetchPacificaLiqs(symbol, hours),
    fetchBinanceLiqs(symbol, hours),
    fetchHyperliquidLiqs(symbol, hours),
    fetchBybitLiqs(symbol, hours),
  ]);

  const all = [...pacifica, ...binance, ...hyperliquid, ...bybit]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  // Summary per source
  const summary = {
    pacifica:    { long: 0, short: 0, total: 0, count: pacifica.length },
    binance:     { long: 0, short: 0, total: 0, count: binance.length },
    hyperliquid: { long: 0, short: 0, total: 0, count: hyperliquid.length },
    bybit:       { long: 0, short: 0, total: 0, count: bybit.length },
  };
  for (const e of all) {
    const s = summary[e.source];
    if (e.side === 'long') s.long += e.notional; else s.short += e.notional;
    s.total += e.notional;
  }

  return NextResponse.json({ events: all, summary });
}
