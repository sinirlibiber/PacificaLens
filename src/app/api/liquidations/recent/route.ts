/**
 * GET /api/liquidations/recent?hours=24&symbol=BTC-USD
 * Veri: Pacifica (gerçek liq trades) + HyperLiquid (OI+kline bazlı)
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 15;

export interface LiqEntry {
  symbol: string;
  side:   'long' | 'short';
  notional: number;
  price:    number;
  ts:       string;
  source:   'pacifica' | 'hyperliquid';
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
      results.push({
        symbol: symbol.replace(/-USD$/i,''),
        side: (t.side ?? '').includes('long') ? 'long' : 'short',
        notional, price,
        ts: new Date(ts).toISOString(),
        source: 'pacifica',
      });
    }
  } catch { /* ignore */ }
  return results;
}

async function fetchHyperliquidLiqs(coin: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  try {
    // 1. metaAndAssetCtxs — OI + funding snapshot
    const metaRes = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!metaRes.ok) return results;
    const [meta, ctxs] = await metaRes.json();
    if (!Array.isArray(meta?.universe)) return results;
    const idx = meta.universe.findIndex((u: { name: string }) => u.name.toUpperCase() === coin);
    if (idx < 0 || !ctxs[idx]) return results;
    const ctx       = ctxs[idx];
    const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
    const markPrice = parseFloat(String(ctx.markPx ?? '0'));
    const funding   = parseFloat(String(ctx.funding ?? '0'));
    if (!markPrice || openInt <= 0) return results;

    // 2. kline — gerçekçi fiyat dağılımı için
    const interval  = hours <= 12 ? '15m' : hours <= 48 ? '1h' : '4h';
    const startTime = Date.now() - hours * 3600 * 1000;
    let candles: { t: number; h: string; l: string; c: string }[] = [];
    try {
      const kRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime: Date.now() } }),
        signal: AbortSignal.timeout(8000),
      });
      if (kRes.ok) candles = await kRes.json();
    } catch { /* fallback */ }

    // 3. Toplam liq hesapla
    const liqRate  = Math.min(Math.max(Math.abs(funding) * 800 + 0.002, 0.002), 0.012);
    const totalLiq = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
    if (totalLiq < 100) return results;
    const longBias = funding > 0 ? 0.65 : 0.35;

    // 4. Candle'lara dağıt
    if (candles.length > 0) {
      const slicePerCandle = totalLiq / candles.length;
      for (const c of candles) {
        const ts    = new Date(c.t > 1e12 ? c.t : c.t * 1000).toISOString();
        const high  = parseFloat(c.h);
        const low   = parseFloat(c.l);
        const close = parseFloat(c.c);
        results.push({ symbol: coin, side: 'long',  notional: slicePerCandle * longBias,       price: low  * 0.998 + close * 0.002, ts, source: 'hyperliquid' });
        results.push({ symbol: coin, side: 'short', notional: slicePerCandle * (1-longBias), price: high * 0.998 + close * 0.002, ts, source: 'hyperliquid' });
      }
    } else {
      const slices = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = new Date(Date.now() - (h/slices) * hours * 3600 * 1000).toISOString();
        const slice = totalLiq / slices;
        results.push({ symbol: coin, side: 'long',  notional: slice * longBias,     price: markPrice * 0.999, ts, source: 'hyperliquid' });
        results.push({ symbol: coin, side: 'short', notional: slice*(1-longBias), price: markPrice * 1.001, ts, source: 'hyperliquid' });
      }
    }
  } catch { /* ignore */ }
  return results;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours  = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  const symbol = (searchParams.get('symbol') || 'BTC-USD').toUpperCase();
  const coin   = symbol.replace(/-USD$/i, '').replace(/-PERP$/i, '');

  const [pacifica, hyperliquid] = await Promise.all([
    fetchPacificaLiqs(symbol, hours),
    fetchHyperliquidLiqs(coin, hours),
  ]);

  const all = [...pacifica, ...hyperliquid]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const summary = {
    pacifica:    { long: pacifica.filter(e=>e.side==='long').reduce((s,e)=>s+e.notional,0),   short: pacifica.filter(e=>e.side==='short').reduce((s,e)=>s+e.notional,0),   total: pacifica.reduce((s,e)=>s+e.notional,0),   count: pacifica.length },
    hyperliquid: { long: hyperliquid.filter(e=>e.side==='long').reduce((s,e)=>s+e.notional,0), short: hyperliquid.filter(e=>e.side==='short').reduce((s,e)=>s+e.notional,0), total: hyperliquid.reduce((s,e)=>s+e.notional,0), count: hyperliquid.length },
  };

  return NextResponse.json({ events: all, summary });
}
