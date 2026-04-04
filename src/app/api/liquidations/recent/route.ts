/**
 * GET /api/liquidations/recent?hours=24&symbol=BTC-USD
 * 
 * Liq veri kaynakları:
 * 1. Pacifica: anlık trade stream (cause=market_liquidation)
 * 2. Binance:  allForceOrders (gerçek force orders)
 * 3. Hyperliquid: OI + funding bazlı tahmin, fiyatlar candle wicks'e dağıtılmış
 * 4. Bybit: liquidation endpoint
 * 
 * Symbol eşleştirme: BTC-USD → BTCUSDT (Binance/Bybit), BTC (Hyperliquid)
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 20;

export interface LiqEntry {
  symbol: string;
  side:   'long' | 'short';
  notional: number;
  price:    number;
  ts:       string;
  source:   'pacifica' | 'binance' | 'hyperliquid' | 'bybit';
}

// ── Pacifica: gerçek liq trade'leri ────────────────────────────────────────
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
      const ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
      if (ts < cutoff) continue;
      const price    = parseFloat(t.price ?? '0');
      const notional = price * parseFloat(t.amount ?? '0');
      if (!notional || notional < 10) continue;
      results.push({
        symbol, notional, price,
        side: (t.side ?? '').includes('long') ? 'long' : 'short',
        ts:   new Date(ts).toISOString(),
        source: 'pacifica',
      });
    }
  } catch { /* ignore */ }
  return results;
}

// ── Binance: gerçek force orders ────────────────────────────────────────────
async function fetchBinanceLiqs(coin: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${coin}USDT&limit=500`,
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
      results.push({
        symbol: coin, notional, price,
        side: o.side === 'BUY' ? 'short' : 'long',
        ts:   new Date(ts || Date.now()).toISOString(),
        source: 'binance',
      });
    }
  } catch { /* ignore */ }
  return results;
}

// ── Hyperliquid: kline + OI bazlı gerçekçi liq dağılımı ────────────────────
async function fetchHyperliquidLiqs(coin: string, hours: number): Promise<LiqEntry[]> {
  const results: LiqEntry[] = [];
  try {
    // 1. OI + funding snapshot
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
    const dayVol    = parseFloat(String(ctx.dayNtlVlm ?? '0'));
    if (!markPrice || openInt <= 0) return results;

    // 2. Hyperliquid kline — fiyat dağılımı için
    const interval = hours <= 12 ? '15m' : hours <= 48 ? '1h' : '4h';
    const startTime = Date.now() - hours * 3600 * 1000;
    let candles: { t: number; h: string; l: string; c: string }[] = [];
    try {
      const kRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime: Date.now() } }),
        signal: AbortSignal.timeout(8000),
      });
      if (kRes.ok) candles = await kRes.json();
    } catch { /* use markPrice fallback */ }

    // 3. Toplam liq miktarı hesapla
    // Funding imbalance ne kadar büyükse o kadar liq, OI bazlı
    const liqRate  = Math.min(Math.max(Math.abs(funding) * 800 + 0.002, 0.002), 0.012);
    const totalLiq = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
    if (totalLiq < 100) return results;

    // Longs vs shorts — funding pozitifse longs daha fazla ödüyor = daha riskli
    const longBias = funding > 0 ? 0.65 : 0.35;

    // 4. Liq'leri candle'lara fiyat ile dağıt
    if (candles.length > 0) {
      const slicePerCandle = totalLiq / candles.length;
      for (const c of candles) {
        const ts   = new Date(c.t > 1e12 ? c.t : c.t * 1000).toISOString();
        const high = parseFloat(c.h);
        const low  = parseFloat(c.l);
        const close= parseFloat(c.c);

        // Short liq: fiyat yükselince short'lar likide edilir → high yakını
        const shortPrice = high * 0.998 + close * 0.002;
        // Long liq: fiyat düşünce long'lar likide edilir → low yakını
        const longPrice  = low  * 0.998 + close * 0.002;

        results.push({ symbol: coin, side: 'long',  notional: slicePerCandle * longBias,       price: longPrice,  ts, source: 'hyperliquid' });
        results.push({ symbol: coin, side: 'short', notional: slicePerCandle * (1-longBias), price: shortPrice, ts, source: 'hyperliquid' });
      }
    } else {
      // Fallback: sadece markPrice etrafında dağıt
      const slices = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = new Date(Date.now() - (h/slices) * hours * 3600 * 1000).toISOString();
        const slice = totalLiq / slices;
        const jitter = 0.003; // ±0.3% fiyat dağılımı
        results.push({ symbol: coin, side: 'long',  notional: slice * longBias,     price: markPrice * (1 - jitter * Math.random()), ts, source: 'hyperliquid' });
        results.push({ symbol: coin, side: 'short', notional: slice*(1-longBias), price: markPrice * (1 + jitter * Math.random()), ts, source: 'hyperliquid' });
      }
    }
  } catch { /* ignore */ }
  return results;
}

// ── Bybit: liquidation history ──────────────────────────────────────────────
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
      results.push({
        symbol: coin, notional, price,
        side: t.side === 'Buy' ? 'short' : 'long',
        ts:   new Date(ts || Date.now()).toISOString(),
        source: 'bybit',
      });
    }
  } catch { /* ignore */ }
  return results;
}

// ── Route ────────────────────────────────────────────────────────────────────
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
  const summary = {} as Record<Src, {long:number;short:number;total:number;count:number}>;

  for (const [src, arr] of [['pacifica',pacifica],['binance',binance],['hyperliquid',hyperliquid],['bybit',bybit]] as [Src, LiqEntry[]][]) {
    let long=0, short=0;
    for (const e of arr) { if(e.side==='long') long+=e.notional; else short+=e.notional; }
    summary[src] = { long, short, total: long+short, count: arr.length };
  }

  return NextResponse.json({ events: all, summary });
}
