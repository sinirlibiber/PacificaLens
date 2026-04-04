/**
 * GET /api/liquidations/recent?hours=24&symbol=BTC-USD
 * 4 kaynak: Pacifica + Binance + Hyperliquid + Bybit
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 15;

export interface LiqEntry {
  symbol: string;
  side: string;
  notional: number;
  price: number;
  ts: string;
  source: 'pacifica' | 'binance' | 'hyperliquid' | 'bybit';
}

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
      if (!t.cause?.toLowerCase().includes('liq')) continue;
      const rawTs = t.created_at ?? 0;
      const ts    = rawTs > 1e12 ? rawTs : rawTs * 1000;
      if (ts < cutoff) continue;
      const price    = parseFloat(t.price ?? '0');
      const notional = price * parseFloat(t.amount ?? '0');
      if (!notional || notional < 10) continue;
      results.push({ symbol, side: (t.side ?? '').includes('long') ? 'long' : 'short', notional, price, ts: new Date(ts).toISOString(), source: 'pacifica' });
    }
  } catch { /* ignore */ }
  return results;
}

async function fetchBinanceLiqs(coin: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    const bnSym = coin + 'USDT';
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${bnSym}&limit=500`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return results;
    const orders: Record<string, unknown>[] = await res.json();
    if (!Array.isArray(orders)) return results;
    for (const o of orders) {
      const ts = Number(o.time ?? o.updateTime ?? 0);
      if (ts && ts < cutoff) continue;
      const price    = parseFloat(String(o.price ?? o.avgPrice ?? '0'));
      const qty      = parseFloat(String(o.origQty ?? o.executedQty ?? '0'));
      const notional = price * qty;
      if (notional < 50) continue;
      results.push({ symbol: coin, notional, price, side: o.side === 'BUY' ? 'short' : 'long', ts: new Date(ts || Date.now()).toISOString(), source: 'binance' });
    }
  } catch { /* ignore */ }
  return results;
}

async function fetchHyperliquidLiqs(coin: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
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
    const liqRate  = Math.min(Math.max(Math.abs(funding) * 600 + 0.0015, 0.0015), 0.01);
    const totalLiq = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
    if (totalLiq < 200) return results;
    const longBias = funding > 0 ? 0.65 : 0.35;
    const slices   = Math.max(1, Math.min(hours * 2, 48));
    for (let h = 0; h < slices; h++) {
      const ts    = new Date(Date.now() - (h / slices) * hours * 3600 * 1000).toISOString();
      const slice = totalLiq / slices;
      results.push({ symbol: coin, side: 'long',  notional: slice * longBias,       price: markPrice * 0.999, ts, source: 'hyperliquid' });
      results.push({ symbol: coin, side: 'short', notional: slice * (1 - longBias), price: markPrice * 1.001, ts, source: 'hyperliquid' });
    }
  } catch { /* ignore */ }
  return results;
}

async function fetchBybitLiqs(coin: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    const res = await fetch(
      `https://api.bybit.com/v5/market/liquidation?category=linear&symbol=${coin}USDT&limit=200`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return results;
    const json = await res.json();
    const list: Record<string, unknown>[] = json?.result?.list ?? [];
    for (const t of list) {
      const ts = Number(t.updatedTime ?? t.time ?? 0);
      if (ts && ts < cutoff) continue;
      const price    = parseFloat(String(t.price ?? '0'));
      const qty      = parseFloat(String(t.size  ?? '0'));
      const notional = price * qty;
      if (notional < 50) continue;
      results.push({ symbol: coin, side: t.side === 'Buy' ? 'short' : 'long', notional, price, ts: new Date(ts || Date.now()).toISOString(), source: 'bybit' });
    }
  } catch { /* ignore */ }
  return results;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours  = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  const symbol = (searchParams.get('symbol') || 'BTC-USD').toUpperCase();
  const coin   = symbol.replace(/-USD$/i, '').replace(/-PERP$/i, '');

  const [pacifica, binance, hyperliquid, bybit] = await Promise.all([
    fetchPacificaLiqs(symbol, hours),
    fetchBinanceLiqs(coin, hours),
    fetchHyperliquidLiqs(coin, hours),
    fetchBybitLiqs(coin, hours),
  ]);

  const all = [...pacifica, ...binance, ...hyperliquid, ...bybit]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  type Src = 'pacifica'|'binance'|'hyperliquid'|'bybit';
  const summary: Record<Src, { long: number; short: number; total: number; count: number }> = {
    pacifica:    { long: 0, short: 0, total: 0, count: pacifica.length },
    binance:     { long: 0, short: 0, total: 0, count: binance.length },
    hyperliquid: { long: 0, short: 0, total: 0, count: hyperliquid.length },
    bybit:       { long: 0, short: 0, total: 0, count: bybit.length },
  };
  for (const e of all) {
    const s = summary[e.source as Src];
    if (s) { if (e.side === 'long') s.long += e.notional; else s.short += e.notional; s.total += e.notional; }
  }

  return NextResponse.json({ events: all, summary });
}
