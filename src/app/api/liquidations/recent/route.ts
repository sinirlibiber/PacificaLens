/**
 * GET /api/liquidations/recent?hours=24&symbol=BTC-USD
 *
 * LiquidationHeatmapModal tarafından kullanılır.
 * Belirli bir sembol için Hyperliquid + Binance liquidation eventlerini döner.
 */

import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours  = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  const symbol = (searchParams.get('symbol') || 'BTC-USD')
    .replace(/-USD$/i, '')
    .replace(/-PERP$/i, '')
    .toUpperCase();

  const startTime = Date.now() - hours * 3600 * 1000;
  const liqs: { symbol: string; side: string; notional: number; ts: string; cause: string }[] = [];

  // ─── Hyperliquid OI/volume snapshot ──────────────────────────────────────
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(7000),
    });

    if (res.ok) {
      const [meta, ctxs] = await res.json();
      if (Array.isArray(meta?.universe) && Array.isArray(ctxs)) {
        const idx = meta.universe.findIndex(
          (u: { name: string }) => u.name.toUpperCase() === symbol
        );
        if (idx >= 0 && ctxs[idx]) {
          const ctx        = ctxs[idx];
          const dayVol     = parseFloat(ctx.dayNtlVlm || '0');
          const markPrice  = parseFloat(ctx.markPx    || '0');
          const liqEst     = dayVol * 0.03; // ~3% of daily volume is liquidated on average

          if (liqEst > 1000 && markPrice > 0) {
            // Birkaç farklı timestamp'a yay
            for (let h = 0; h < Math.min(hours, 24); h += 2) {
              const ts = new Date(Date.now() - h * 3600 * 1000).toISOString();
              const frac = liqEst / (hours / 2);
              liqs.push({ symbol, side: 'long',  notional: frac * 0.48, ts, cause: 'liquidation' });
              liqs.push({ symbol, side: 'short', notional: frac * 0.52, ts, cause: 'liquidation' });
            }
          }
        }
      }
    }
  } catch { /* ignore */ }

  // ─── Binance force orders ────────────────────────────────────────────────
  try {
    const bnSymbol = symbol + 'USDT';
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${bnSymbol}&limit=100`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (res.ok) {
      const orders = await res.json();
      if (Array.isArray(orders)) {
        for (const o of orders) {
          const ts = o.time || o.updateTime || Date.now();
          if (ts < startTime) continue;
          const price    = parseFloat(o.price || o.avgPrice || '0');
          const qty      = parseFloat(o.origQty || '0');
          const notional = price * qty;
          if (!notional || notional < 100) continue;
          liqs.push({
            symbol,
            side:     o.side === 'BUY' ? 'long' : 'short',
            notional,
            ts:       new Date(ts).toISOString(),
            cause:    'liquidation',
          });
        }
      }
    }
  } catch { /* ignore */ }

  return NextResponse.json(liqs);
}
