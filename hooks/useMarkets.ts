'use client';

import { useEffect, useState, useRef } from 'react';
import { getMarkets, getTickers, Market, Ticker, FundingRate } from '@/lib/pacifica';

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [fundingRates, setFundingRates] = useState<Record<string, FundingRate>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevTickersRef = useRef<Record<string, Ticker>>({});

  // Derive funding rates from tickers — same endpoint, no double fetch
  function deriveFundingRates(tickerMap: Record<string, Ticker>): Record<string, FundingRate> {
    return Object.fromEntries(
      Object.values(tickerMap).map(t => [t.symbol, { symbol: t.symbol, funding_rate: t.funding ?? '0' }])
    );
  }

  // Only update tickers state if values actually changed — prevents unnecessary re-renders
  function setTickersIfChanged(next: Record<string, Ticker>) {
    const prev = prevTickersRef.current;
    const changed = Object.keys(next).some(k => {
      const a = prev[k]; const b = next[k];
      if (!a || !b) return true;
      return a.mark !== b.mark || a.funding !== b.funding || a.volume_24h !== b.volume_24h;
    });
    if (changed) {
      prevTickersRef.current = next;
      setTickers(next);
      setFundingRates(deriveFundingRates(next));
    }
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        // Single parallel fetch — markets static, tickers dynamic
        const [m, t] = await Promise.all([getMarkets(), getTickers()]);
        setMarkets(m);
        prevTickersRef.current = t;
        setTickers(t);
        setFundingRates(deriveFundingRates(t));
        if (m.length === 0) setError('No markets returned');
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    init();

    // Poll tickers only — markets don't change
    const iv = setInterval(async () => {
      try {
        const t = await getTickers();
        if (Object.keys(t).length > 0) setTickersIfChanged(t);
      } catch {}
    }, 5000);

    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { markets, tickers, fundingRates, loading, error };
}
