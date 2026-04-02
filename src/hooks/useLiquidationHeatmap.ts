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

const REFRESH_MS = 2 * 60 * 1000; // 2 dakikada bir yenile
const CACHE_KEY  = 'pl_liq_heatmap_v3'; // bumped to bust old cache

// ── localStorage cache ────────────────────────────────────────────────────────
function loadCache(): { data: LiqSymbolData[]; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // 2 dakikadan eski değilse kullan
    if (Date.now() - entry.fetchedAt < REFRESH_MS) return entry;
    return null;
  } catch { return null; }
}

function saveCache(data: LiqSymbolData[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch {}
}

// ── Fetch from Supabase via API route ─────────────────────────────────────────
async function fetchFromDB(markets: Market[]): Promise<LiqSymbolData[]> {
  try {
    const res = await fetch('/api/liquidations?hours=24', { cache: 'no-store' });
    if (!res.ok) throw new Error('api error');
    const dbData: LiqSymbolData[] = await res.json();

    // Merge with full market list so all 63 coins show (even with 0)
    const map = new Map<string, LiqSymbolData>();
    for (const d of dbData) map.set(d.symbol, d);

    const result: LiqSymbolData[] = markets.map(m =>
      map.get(m.symbol) ?? { symbol: m.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 }
    );

    return result.sort((a, b) => b.total - a.total);
  } catch {
    return markets.map(m => ({ symbol: m.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 }));
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
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

    // 1. Anında cache'den yükle (sayfa yenilenince veri kaybolmaz)
    const cached = loadCache();
    if (cached) {
      setData(cached.data);
      setLastFetch(new Date(cached.fetchedAt));
    }

    const run = async (force = false) => {
      if (!mountedRef.current) return;
      if (!force) {
        const c = loadCache();
        if (c) { setData(c.data); setLastFetch(new Date(c.fetchedAt)); return; }
      }
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

    // Cache yoksa hemen fetch et
    if (!cached) run(true);

    // 2 dakikada bir yenile
    timerRef.current = setInterval(() => run(true), REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [markets.length]);

  return { data, loading, lastFetch };
}
