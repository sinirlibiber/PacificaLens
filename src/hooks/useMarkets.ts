'use client';

import { useEffect, useState } from 'react';
import { getMarkets, getTickers, getFundingRates, Market, Ticker, FundingRate } from '@/lib/pacifica';

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [fundingRates, setFundingRates] = useState<Record<string, FundingRate>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const [m, t, f] = await Promise.all([getMarkets(), getTickers(), getFundingRates()]);
        setMarkets(m);
        setTickers(t);
        setFundingRates(f);
        if (m.length === 0) setError('No markets returned');
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    init();

    // Fiyatları 3 saniyede bir güncelle
    const iv = setInterval(async () => {
      try {
        const t = await getTickers();
        if (Object.keys(t).length > 0) setTickers(t);
      } catch {}
    }, 3000);

    return () => clearInterval(iv);
  }, []);

  return { markets, tickers, fundingRates, loading, error };
}
