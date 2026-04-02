'use client';
import { useState, useEffect, useRef } from 'react';
import { Market } from '@/lib/pacifica';

export interface LiqSymbolData {
  symbol: string;
  longLiq: number;
  shortLiq: number;
  total: number;
  count: number;
}

interface CacheEntry {
  data: LiqSymbolData[];
  fetchedAt: number;
}

const REFRESH_MS  = 5 * 60 * 1000;
const TTL_24H     = 24 * 60 * 60 * 1000;
const CONCURRENCY = 10;
const CACHE_KEY   = 'pl_liq_heatmap_cache';

// ── localStorage persistence ───────────────────────────────────────────────────
function loadCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    // Cache geçerliyse (5 dakikadan eski değilse) kullan
    if (Date.now() - entry.fetchedAt < REFRESH_MS) return entry;
    return null;
  } catch { return null; }
}

function saveCache(data: LiqSymbolData[]) {
  try {
    const entry: CacheEntry = { data, fetchedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch { /* quota exceeded — ignore */ }
}

// ── Fetch single symbol ────────────────────────────────────────────────────────
async function fetchSymbolLiqs(symbol: string): Promise<LiqSymbolData> {
  const result: LiqSymbolData = { symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 };
  try {
    const res = await fetch(
      `/api/proxy?path=${encodeURIComponent(`trades?symbol=${symbol}&limit=500`)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return result;
    const json = await res.json();
    const trades: { cause: string; side: string; price: string; amount: string; created_at: number }[] =
      (json.success && Array.isArray(json.data)) ? json.data : [];

    const cutoff = Date.now() - TTL_24H;

    for (const t of trades) {
      const isLiq = t.cause === 'market_liquidation'
        || t.cause === 'backstop_liquidation'
        || (typeof t.cause === 'string' && t.cause.toLowerCase().includes('liq'));
      if (!isLiq) continue;

      const ts = t.created_at > 1e12 ? t.created_at : t.created_at * 1000;
      if (ts < cutoff) continue;

      const notional = parseFloat(t.price) * parseFloat(t.amount);
      if (!notional || isNaN(notional)) continue;

      const isLong = t.side?.includes('long');
      if (isLong) result.longLiq += notional;
      else        result.shortLiq += notional;
      result.total += notional;
      result.count++;
    }
  } catch { /* timeout — return zeros */ }
  return result;
}

async function fetchAllSymbols(symbols: string[]): Promise<LiqSymbolData[]> {
  const results: LiqSymbolData[] = [];
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const res   = await Promise.all(batch.map(fetchSymbolLiqs));
    results.push(...res);
  }
  return results;
}

// ── Hook ───────────────────────────────────────────────────────────────────────
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

    // 1. Immediately show cached data if available (instant load on refresh)
    const cached = loadCache();
    if (cached) {
      setData(cached.data);
      setLastFetch(new Date(cached.fetchedAt));
    }

    const symbols = markets.map(m => m.symbol);

    const run = async (force = false) => {
      if (!mountedRef.current) return;
      // Skip fetch if cache is fresh and not forced
      if (!force) {
        const c = loadCache();
        if (c) { setData(c.data); setLastFetch(new Date(c.fetchedAt)); return; }
      }
      setLoading(true);
      try {
        const results = await fetchAllSymbols(symbols);
        if (!mountedRef.current) return;
        // All symbols present (including zeros) — sorted by total desc
        const sorted = [...results].sort((a, b) => b.total - a.total);
        saveCache(sorted);
        setData(sorted);
        setLastFetch(new Date());
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    // If no cache, fetch immediately; else schedule next refresh
    if (!cached) run(true);

    // Refresh every 5 min regardless
    timerRef.current = setInterval(() => run(true), REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [markets.length]);

  return { data, loading, lastFetch };
}
