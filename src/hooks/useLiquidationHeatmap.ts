'use client';
/**
 * useLiquidationHeatmap  — v2 (Supabase-free, multi-exchange)
 *
 * Fetches from /api/liq-multi which aggregates:
 *   Hyperliquid · Aster · dYdX · Binance
 *
 * Only returns data for symbols that exist on Pacifica (filtered server-side).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Market } from '@/lib/pacifica';

export type Exchange = 'all' | 'hyperliquid' | 'aster' | 'dydx' | 'binance';

export interface LiqSymbolData {
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

export interface LiqEvent {
  id:       string;
  exchange: Exclude<Exchange, 'all'>;
  symbol:   string;
  side:     'long' | 'short';
  price:    number;
  notional: number;
  ts:       number;
}

export interface SourceCounts {
  hyperliquid: number;
  aster:       number;
  dydx:        number;
  binance:     number;
}

const REFRESH_MS = 2 * 60 * 1_000;
const CACHE_KEY  = 'pl_liq_multi_v1';

function loadCache(exchange: Exchange) {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}_${exchange}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.fetchedAt > REFRESH_MS) return null;
    return entry as { data: LiqSymbolData[]; recent: LiqEvent[]; sources: SourceCounts; fetchedAt: number };
  } catch { return null; }
}

function saveCache(exchange: Exchange, data: LiqSymbolData[], recent: LiqEvent[], sources: SourceCounts) {
  try {
    localStorage.setItem(`${CACHE_KEY}_${exchange}`, JSON.stringify({
      data, recent, sources, fetchedAt: Date.now(),
    }));
  } catch {}
}

async function fetchMultiLiq(
  exchange: Exchange,
  hours: number,
  markets: Market[],
): Promise<{ data: LiqSymbolData[]; recent: LiqEvent[]; sources: SourceCounts }> {
  const params = new URLSearchParams({ hours: String(hours) });
  if (exchange !== 'all') params.set('exchange', exchange);

  try {
    const res = await fetch(`/api/liq-multi?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const summaryMap = new Map<string, LiqSymbolData>();
    for (const s of (json.summary ?? [])) summaryMap.set(s.symbol, s);

    const data: LiqSymbolData[] = markets.map(m => {
      const sym = m.symbol.replace(/-USD$/i, '').toUpperCase();
      return summaryMap.get(sym) ?? {
        symbol: m.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0,
        byExchange: { hyperliquid: 0, aster: 0, dydx: 0, binance: 0 },
      };
    });
    data.sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));

    return {
      data,
      recent:  json.recent ?? [],
      sources: json.meta?.sources ?? { hyperliquid: 0, aster: 0, dydx: 0, binance: 0 },
    };
  } catch (e) {
    console.error('[LiqHeatmap] fetch error:', e);
    return {
      data: markets.map(m => ({
        symbol: m.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0,
        byExchange: { hyperliquid: 0, aster: 0, dydx: 0, binance: 0 },
      })),
      recent: [],
      sources: { hyperliquid: 0, aster: 0, dydx: 0, binance: 0 },
    };
  }
}

export function useLiquidationHeatmap(markets: Market[]) {
  const [exchange,  setExchange ] = useState<Exchange>('all');
  const [hours,     setHours    ] = useState(24);
  const [data,      setData     ] = useState<LiqSymbolData[]>([]);
  const [recent,    setRecent   ] = useState<LiqEvent[]>([]);
  const [sources,   setSources  ] = useState<SourceCounts>({ hyperliquid: 0, aster: 0, dydx: 0, binance: 0 });
  const [loading,   setLoading  ] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const run = useCallback(async (forceRefresh = false) => {
    if (!markets.length) return;
    if (!forceRefresh) {
      const cached = loadCache(exchange);
      if (cached) {
        setData(cached.data); setRecent(cached.recent);
        setSources(cached.sources); setLastFetch(new Date(cached.fetchedAt));
      }
    }
    if (forceRefresh) {
      if (!mountedRef.current) return;
      setLoading(true);
      try {
        const result = await fetchMultiLiq(exchange, hours, markets);
        if (!mountedRef.current) return;
        saveCache(exchange, result.data, result.recent, result.sources);
        setData(result.data); setRecent(result.recent);
        setSources(result.sources); setLastFetch(new Date());
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [exchange, hours, markets.length]); // eslint-disable-line

  useEffect(() => {
    if (!markets.length) return;
    if (timerRef.current) clearInterval(timerRef.current);
    run(false);
    run(true);
    timerRef.current = setInterval(() => run(true), REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [run]);

  return { data, recent, sources, loading, lastFetch, exchange, setExchange, hours, setHours };
}
