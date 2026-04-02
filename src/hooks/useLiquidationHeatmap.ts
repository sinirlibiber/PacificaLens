'use client';
import { useState, useEffect, useRef } from 'react';
import { Market } from '@/lib/pacifica';

export interface LiqSymbolData {
  symbol:   string;
  longLiq:  number;
  shortLiq: number;
  total:    number;
  count:    number;
}

const REFRESH_MS = 2 * 60 * 1000;
const CACHE_KEY  = 'pl_liq_heatmap_v4';

function loadCache(marketCount: number): { data: LiqSymbolData[]; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // stale if > 2min or market count changed
    if (Date.now() - entry.fetchedAt > REFRESH_MS) return null;
    if (entry.data?.length !== marketCount) return null;
    return entry;
  } catch { return null; }
}

function saveCache(data: LiqSymbolData[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch {}
}

async function fetchFromDB(markets: Market[]): Promise<LiqSymbolData[]> {
  try {
    const res = await fetch('/api/liquidations?hours=24', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    const dbData: LiqSymbolData[] = await res.json();

    // Build lookup map
    const map = new Map<string, LiqSymbolData>();
    for (const d of dbData) map.set(d.symbol, d);

    // Return ALL markets — with liq data where available, zeros otherwise
    const result: LiqSymbolData[] = markets.map(m =>
      map.get(m.symbol) ?? { symbol: m.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 }
    );

    // Sort: liq coins first, then alphabetical
    result.sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));
    return result;
  } catch (e) {
    console.error('[LiqHeatmap] fetch error:', e);
    return markets.map(m => ({ symbol: m.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 }));
  }
}

export function useLiquidationHeatmap(markets: Market[]) {
  const [data,      setData     ] = useState<LiqSymbolData[]>([]);
  const [loading,   setLoading  ] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!markets.length) return;
    if (timerRef.current) clearInterval(timerRef.current);

    // Clear stale cache on market change
    const cached = loadCache(markets.length);

    // Show cached data immediately if fresh
    if (cached) {
      setData(cached.data);
      setLastFetch(new Date(cached.fetchedAt));
    }

    const run = async () => {
      if (!mountedRef.current) return;
      setLoading(true);
      try {
        const result = await fetchFromDB(markets);
        if (!mountedRef.current) return;
        saveCache(result);
        setData(result);
        setLastFetch(new Date());
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    // Always fetch fresh data on mount regardless of cache
    run();
    timerRef.current = setInterval(run, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [markets.length]);

  return { data, loading, lastFetch };
}
