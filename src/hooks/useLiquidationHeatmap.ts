'use client';
import { useState, useEffect, useRef } from 'react';
import { Market } from '@/lib/pacifica';

export interface LiqSymbolData {
  symbol: string;
  longLiq: number;   // USD notional
  shortLiq: number;
  total: number;
  count: number;
}

const REFRESH_MS = 5 * 60 * 1000; // 5 dakika
const TTL_24H    = 24 * 60 * 60 * 1000;
// Paralel fetch limiti — 63 coin için aynı anda max 10 istek
const CONCURRENCY = 10;

async function fetchSymbolLiqs(symbol: string): Promise<LiqSymbolData> {
  const result: LiqSymbolData = { symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 };
  try {
    const res = await fetch(
      `/api/proxy?path=${encodeURIComponent(`trades?symbol=${symbol}&limit=500`)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return result;
    const json = await res.json();
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LiqHeatmap] ${symbol}: fetched`);
    }
    const trades: { cause: string; side: string; price: string; amount: string; created_at: number }[] =
      (json.success && Array.isArray(json.data)) ? json.data : [];

    const cutoff = Date.now() - TTL_24H;

    // DEBUG: log unique cause values to find correct liquidation identifier
    if (process.env.NODE_ENV === 'development' && trades.length > 0) {
      const causes = [...new Set(trades.map(t => t.cause))];
      console.log(`[LiqHeatmap] ${symbol} causes:`, causes, `total:${trades.length}`);
    }
    for (const t of trades) {
      const isLiq = t.cause === 'market_liquidation' || t.cause === 'backstop_liquidation' || (typeof t.cause === 'string' && t.cause.toLowerCase().includes('liq'));
      if (!isLiq) continue;

      // created_at: normalize seconds → ms
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
  } catch {
    // timeout veya hata — 0 döner, heatmap'te görünmez
  }
  return result;
}

// Concurrency-limited parallel fetch
async function fetchAllSymbols(symbols: string[]): Promise<LiqSymbolData[]> {
  const results: LiqSymbolData[] = [];
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(fetchSymbolLiqs));
    results.push(...batchResults);
  }
  return results;
}

export function useLiquidationHeatmap(markets: Market[]) {
  const [data, setData]       = useState<LiqSymbolData[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!markets.length) return;

    const symbols = markets.map(m => m.symbol);

    const run = async () => {
      if (!mountedRef.current) return;
      setLoading(true);
      try {
        const results = await fetchAllSymbols(symbols);
        if (!mountedRef.current) return;
        // sadece en az 1 liq olan coinleri al, büyükten küçüğe sırala
        const active = results.filter(r => r.total > 0).sort((a, b) => b.total - a.total);
        setData(active);
        setLastFetch(new Date());
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    run();
    timerRef.current = setInterval(run, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [markets.length]); // markets yüklendiğinde başlat

  return { data, loading, lastFetch };
}
