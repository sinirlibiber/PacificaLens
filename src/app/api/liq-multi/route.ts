/**
 * GET /api/liq-multi
 *
 * Supabase-free multi-exchange liquidation aggregator.
 * Fetches from Hyperliquid, Aster, dYdX and Binance,
 * normalises to a common schema, optionally filters by
 * exchange and by Pacifica's 63 markets.
 *
 * Query params:
 *   hours    – lookback window (default 24, max 168)
 *   exchange – comma-separated list: hyperliquid,aster,dydx,binance  (default = all)
 *   symbol   – optional: single Pacifica symbol (e.g. BTC-USD)
 *
 * Returns:
 *   {
 *     summary: LiqSummary[]          // per-symbol aggregation (for the heatmap grid)
 *     recent:  LiqEvent[]            // raw events sorted newest-first (for dots / recent panel)
 *     meta:    { fetchedAt, sources } // diagnostics
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';

// ── Types ────────────────────────────────────────────────────────────────────
export interface LiqEvent {
  id:       string;   // exchange + trade_id
  exchange: 'hyperliquid' | 'aster' | 'dydx' | 'binance';
  symbol:   string;   // normalised: "BTC"
  side:     'long' | 'short';
  price:    number;
  notional: number;   // USD value
  ts:       number;   // ms epoch
}

export interface LiqSummary {
  symbol:   string;
  longLiq:  number;
  shortLiq: number;
  total:    number;
  count:    number;
  byExchange: {
    hyperliquid: number;
    aster:       number;
    dydx:        number;
    binance:     number;
  };
}

// ── Pacifica 63-market allowlist (normalised, no -USD suffix) ──────────────
// These are fetched dynamically; this is a static fallback cache.
const PACIFICA_SYMBOLS_FALLBACK = new Set([
  'BTC','ETH','SOL','ARB','OP','AVAX','MATIC','DOGE','LINK','UNI',
  'AAVE','CRV','GMX','WIF','PEPE','BONK','JTO','PYTH','TIA','INJ',
  'SUI','APT','SEI','BLUR','LDO','RPL','SUSHI','COMP','MKR','SNX',
  'PERP','YFI','1INCH','ENS','GRT','IMX','SAND','MANA','AXS','GALA',
  'APE','LRC','DYDX','CELO','ZRX','BAL','OCEAN','REN','NMR','BNT',
  'ALICE','CHZ','SKL','ILV','FLOW','NEAR','FTM','ATOM','DOT','XRP',
  'LTC','BCH','ETC','BNB','TON',
]);

// ── Symbol normalisation ──────────────────────────────────────────────────
function norm(raw: string): string {
  return raw
    .replace(/-?(USD[CT]?|PERP|SWAP|USDT|USDC)$/i, '')
    .replace(/^k/, '') // kPEPE → PEPE
    .toUpperCase()
    .trim();
}

// ── Hyperliquid ───────────────────────────────────────────────────────────
// Uses the /info endpoint — type "userFundings" is not public per-symbol,
// but clearinghouse trades endpoint gives us fills with liquidation cause.
// We use the public /info endpoint with type "recentTrades" per coin, but
// that is rate-limited. Instead we use the meta + allMids approach and
// rely on the /api/hyperliquid proxy already in the project.
async function fetchHyperliquid(sinceMs: number, symbols: Set<string>): Promise<LiqEvent[]> {
  try {
    const body = { type: 'liquidations' };
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8000),
      cache:   'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((e: Record<string, unknown>) => {
        const ts = Number((e.time ?? e.ts ?? e.timestamp ?? 0));
        const tsMs = ts > 1e12 ? ts : ts * 1000;
        return tsMs >= sinceMs;
      })
      .map((e: Record<string, unknown>, i: number): LiqEvent | null => {
        const coin = norm(String(e.coin ?? e.asset ?? e.symbol ?? ''));
        if (!coin || !symbols.has(coin)) return null;
        const ts = Number((e.time ?? e.ts ?? e.timestamp ?? 0));
        const tsMs = ts > 1e12 ? ts : ts * 1000;
        const px = Number(e.px ?? e.price ?? 0);
        const sz = Number(e.sz ?? e.size ?? e.amount ?? 0);
        const notional = Number(e.liquidatedNtlPos ?? e.notional ?? px * sz);
        const isLong = String(e.side ?? e.direction ?? '').toLowerCase().includes('long')
          || String(e.type ?? '').toLowerCase().includes('long');
        return {
          id:       `hl-${i}-${tsMs}`,
          exchange: 'hyperliquid',
          symbol:   coin,
          side:     isLong ? 'long' : 'short',
          price:    px,
          notional,
          ts:       tsMs,
        };
      })
      .filter(Boolean) as LiqEvent[];
  } catch {
    return [];
  }
}

// ── Aster (asterdex.com — Binance Futures compatible API) ─────────────────
async function fetchAster(sinceMs: number, symbols: Set<string>): Promise<LiqEvent[]> {
  try {
    // Aster exposes forceOrders endpoint similar to Binance
    const res = await fetch(
      'https://fapi.asterdex.com/fapi/v1/allForceOrders?limit=200',
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((e: Record<string, unknown>) => {
        const ts = Number(e.time ?? e.updateTime ?? 0);
        return ts >= sinceMs;
      })
      .map((e: Record<string, unknown>, i: number): LiqEvent | null => {
        const coin = norm(String(e.symbol ?? ''));
        if (!coin || !symbols.has(coin)) return null;
        const ts = Number(e.time ?? e.updateTime ?? 0);
        const px = Number(e.price ?? e.averagePrice ?? 0);
        const qty = Number(e.origQty ?? e.executedQty ?? 0);
        const notional = Number(e.notional ?? px * qty);
        const side = String(e.side ?? '').toLowerCase();
        // In Binance/Aster: SELL means a long was liquidated, BUY means short
        const isLong = side === 'sell';
        return {
          id:       `aster-${i}-${ts}`,
          exchange: 'aster',
          symbol:   coin,
          side:     isLong ? 'long' : 'short',
          price:    px,
          notional,
          ts,
        };
      })
      .filter(Boolean) as LiqEvent[];
  } catch {
    return [];
  }
}

// ── dYdX v4 ─────────────────────────────────────────────────────────────
async function fetchDydx(sinceMs: number, symbols: Set<string>): Promise<LiqEvent[]> {
  try {
    // dYdX v4 indexer: GET /v4/liquidations?limit=200
    const res = await fetch(
      'https://indexer.dydx.trade/v4/liquidations?limit=200',
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const data: Record<string, unknown>[] = Array.isArray(json)
      ? json
      : Array.isArray(json.liquidations)
        ? json.liquidations
        : [];

    return data
      .filter((e) => {
        const ts = new Date(String(e.createdAt ?? e.created_at ?? 0)).getTime();
        return ts >= sinceMs;
      })
      .map((e, i): LiqEvent | null => {
        const coin = norm(String(e.market ?? e.ticker ?? e.symbol ?? ''));
        if (!coin || !symbols.has(coin)) return null;
        const ts = new Date(String(e.createdAt ?? e.created_at ?? 0)).getTime();
        const px = Number(e.price ?? 0);
        const sz = Number(e.size ?? e.amount ?? 0);
        const notional = Number(e.notional ?? px * sz);
        const side = String(e.side ?? '').toLowerCase();
        const isLong = side === 'buy' || side === 'long';
        return {
          id:       `dydx-${i}-${ts}`,
          exchange: 'dydx',
          symbol:   coin,
          side:     isLong ? 'long' : 'short',
          price:    px,
          notional,
          ts,
        };
      })
      .filter(Boolean) as LiqEvent[];
  } catch {
    return [];
  }
}

// ── Binance Futures force orders ─────────────────────────────────────────
async function fetchBinance(sinceMs: number, symbols: Set<string>): Promise<LiqEvent[]> {
  try {
    const res = await fetch(
      'https://fapi.binance.com/fapi/v1/allForceOrders?limit=200',
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((e: Record<string, unknown>) => Number(e.time ?? e.updateTime ?? 0) >= sinceMs)
      .map((e: Record<string, unknown>, i: number): LiqEvent | null => {
        const coin = norm(String(e.symbol ?? ''));
        if (!coin || !symbols.has(coin)) return null;
        const ts = Number(e.time ?? e.updateTime ?? 0);
        const px = Number(e.price ?? e.averagePrice ?? 0);
        const qty = Number(e.origQty ?? e.executedQty ?? 0);
        const notional = px * qty;
        const side = String(e.side ?? '').toLowerCase();
        const isLong = side === 'sell'; // SELL order = long liquidated
        return {
          id:       `bnb-${i}-${ts}`,
          exchange: 'binance',
          symbol:   coin,
          side:     isLong ? 'long' : 'short',
          price:    px,
          notional,
          ts,
        };
      })
      .filter(Boolean) as LiqEvent[];
  } catch {
    return [];
  }
}

// ── Fetch Pacifica symbol list (with fallback) ────────────────────────────
async function getPacificaSymbols(baseUrl: string): Promise<Set<string>> {
  try {
    const res = await fetch(`${baseUrl}/api/proxy?path=info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      const set = new Set<string>();
      for (const m of json.data) {
        set.add(norm(m.symbol));
      }
      if (set.size > 0) return set;
    }
  } catch { /* fall through */ }
  return PACIFICA_SYMBOLS_FALLBACK;
}

// ── Aggregate events into per-symbol summary ──────────────────────────────
function aggregate(events: LiqEvent[]): LiqSummary[] {
  const map = new Map<string, LiqSummary>();
  for (const e of events) {
    if (!map.has(e.symbol)) {
      map.set(e.symbol, {
        symbol: e.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0,
        byExchange: { hyperliquid: 0, aster: 0, dydx: 0, binance: 0 },
      });
    }
    const s = map.get(e.symbol)!;
    if (e.side === 'long') s.longLiq += e.notional;
    else                   s.shortLiq += e.notional;
    s.total += e.notional;
    s.count++;
    s.byExchange[e.exchange] += e.notional;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// ── Route handler ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const hours    = Math.min(parseInt(req.nextUrl.searchParams.get('hours') || '24'), 168);
  const exchParam = req.nextUrl.searchParams.get('exchange') || 'hyperliquid,aster,dydx,binance';
  const symParam  = req.nextUrl.searchParams.get('symbol') || '';
  const exchanges = new Set(exchParam.toLowerCase().split(',').map(s => s.trim()));
  const sinceMs   = Date.now() - hours * 3600_000;

  // Origin for internal proxy calls (Vercel passes HOST header)
  const host = req.headers.get('host') || 'localhost:3000';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  const baseUrl = `${proto}://${host}`;

  // Get allowed symbols (Pacifica markets)
  const pacificaSymbols = await getPacificaSymbols(baseUrl);
  const filterSymbols = symParam
    ? new Set([norm(symParam)])
    : pacificaSymbols;

  // Fetch in parallel — failed sources return []
  const [hlEvents, asterEvents, dydxEvents, bnbEvents] = await Promise.all([
    exchanges.has('hyperliquid') ? fetchHyperliquid(sinceMs, filterSymbols) : Promise.resolve([]),
    exchanges.has('aster')       ? fetchAster(sinceMs, filterSymbols)       : Promise.resolve([]),
    exchanges.has('dydx')        ? fetchDydx(sinceMs, filterSymbols)        : Promise.resolve([]),
    exchanges.has('binance')     ? fetchBinance(sinceMs, filterSymbols)     : Promise.resolve([]),
  ]);

  const all = (hlEvents as LiqEvent[]).concat(asterEvents, dydxEvents, bnbEvents)
    .sort((a, b) => b.ts - a.ts);

  const summary = aggregate(all);

  return NextResponse.json(
    {
      summary,
      recent:  all.slice(0, 1000), // cap to avoid huge payload
      meta: {
        fetchedAt:  Date.now(),
        hours,
        exchanges:  Array.from(exchanges),
        sources: {
          hyperliquid: hlEvents.length,
          aster:       asterEvents.length,
          dydx:        dydxEvents.length,
          binance:     bnbEvents.length,
        },
      },
    },
    {
      headers: {
        // Cache for 60 s on Vercel Edge — free tier friendly
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    }
  );
}
