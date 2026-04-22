'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

export interface ExchangeRate {
  exchange: string;
  symbol: string;
  fundingRate: number;    // 1h rate as decimal
  markPrice: number;
  askPrice: number;
  bidPrice: number;
  openInterest: number;
  nextFundingTime: number; // unix ms
  color: string;
  logo: string;
}

export interface ArbitrageOpportunity {
  symbol: string;
  long: ExchangeRate;
  short: ExchangeRate;
  spreadRate: number;
  spreadAPR: number;
  bboSpread: number;
  longAction: string;
  shortAction: string;
  tier: 'high' | 'medium' | 'low';
  lastSeen: number;
}

function normSym(s: string): string {
  return s.replace(/-USD$/, '').replace(/USDT$/, '').replace(/-PERP$/, '')
    .replace(/^k/, '').toUpperCase().trim();
}

function nextHourMs(): number {
  const now = Date.now();
  return now + (3600000 - (now % 3600000));
}

async function fetchHyperliquid(): Promise<ExchangeRate[]> {
  try {
    const res = await fetch('/api/hyperliquid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return [];
    const meta = Array.isArray(data[0]) ? data[0][0] : data[0];
    const universe: { name: string }[] = meta?.universe ?? [];
    const ctxs: Record<string, unknown>[] = Array.isArray(data[1]) ? data[1] : [];
    return universe.map((u, i) => {
      const ctx = ctxs[i] ?? {};
      const mark = Number(ctx.markPx ?? 0);
      return {
        exchange: 'Hyperliquid',
        symbol: normSym(u.name),
        fundingRate: Number(ctx.funding ?? 0),
        markPrice: mark,
        askPrice: mark * 1.0001,
        bidPrice: mark * 0.9999,
        openInterest: Number(ctx.openInterest ?? 0) * mark,
        nextFundingTime: nextHourMs(),
        color: '#00C2FF',
        logo: 'HL',
      } as ExchangeRate;
    }).filter((r: ExchangeRate) => r.markPrice > 0);
  } catch { return []; }
}

async function fetchAster(): Promise<ExchangeRate[]> {
  try {
    const res = await fetch('/api/aster?path=fapi/v1/premiumIndex');
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: { symbol: string; lastFundingRate: string; markPrice: string }) => {
      const mark = Number(d.markPrice ?? 0);
      return {
        exchange: 'Aster',
        symbol: normSym(d.symbol),
        fundingRate: Number(d.lastFundingRate ?? 0),
        markPrice: mark,
        askPrice: mark * 1.0001,
        bidPrice: mark * 0.9999,
        openInterest: 0,
        nextFundingTime: nextHourMs(),
        color: '#F59E0B',
        logo: 'AS',
      } as ExchangeRate;
    }).filter((r: ExchangeRate) => r.markPrice > 0);
  } catch { return []; }
}

async function fetchDydx(): Promise<ExchangeRate[]> {
  try {
    const res = await fetch('/api/dydx?path=v4/perpetualMarkets');
    const data = await res.json();
    const markets = data?.markets ?? {};
    return Object.values(markets).map((m: unknown) => {
      const market = m as {
        ticker: string; nextFundingRate: string; oraclePrice: string;
        openInterest: string; nextFundingAt?: string;
      };
      const mark = Number(market.oraclePrice ?? 0);
      const nextFunding = market.nextFundingAt ? new Date(market.nextFundingAt).getTime() : nextHourMs();
      return {
        exchange: 'dYdX',
        symbol: normSym(market.ticker),
        fundingRate: Number(market.nextFundingRate ?? 0),
        markPrice: mark,
        askPrice: mark * 1.0001,
        bidPrice: mark * 0.9999,
        openInterest: Number(market.openInterest ?? 0),
        nextFundingTime: nextFunding,
        color: '#8B5CF6',
        logo: 'DX',
      } as ExchangeRate;
    }).filter((r: ExchangeRate) => r.markPrice > 0);
  } catch { return []; }
}

export function useArbitrage(pacificaRates: Record<string, number>, pacificaPrices: Record<string, number>) {
  const [opportunities, setOpportunities] = useState<ArbitrageOpportunity[]>([]);
  const [allRates, setAllRates] = useState<ExchangeRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const notifiedRef = useRef<Set<string>>(new Set());

  const compute = useCallback(async () => {
    const [hl, aster, dydx] = await Promise.allSettled([
      fetchHyperliquid(),
      fetchAster(),
      fetchDydx(),
    ]);

    const newErrors: Record<string, string> = {};
    const exRates: ExchangeRate[] = [];
    if (hl.status === 'fulfilled') exRates.push(...hl.value);
    else newErrors['Hyperliquid'] = 'Fetch failed';
    if (aster.status === 'fulfilled') exRates.push(...aster.value);
    else newErrors['Aster'] = 'Fetch failed';
    if (dydx.status === 'fulfilled') exRates.push(...dydx.value);
    else newErrors['dYdX'] = 'Fetch failed';

    setErrors(newErrors);
    setAllRates(exRates);

    const bySymbol: Record<string, ExchangeRate[]> = {};
    for (const [sym, rate] of Object.entries(pacificaRates)) {
      const ns = normSym(sym);
      const mark = pacificaPrices[sym] ?? 0;
      if (!bySymbol[ns]) bySymbol[ns] = [];
      bySymbol[ns].push({
        exchange: 'Pacifica',
        symbol: ns,
        fundingRate: rate,
        markPrice: mark,
        askPrice: mark * 1.0001,
        bidPrice: mark * 0.9999,
        openInterest: 0,
        nextFundingTime: nextHourMs(),
        color: '#00B4D8',
        logo: 'PA',
      });
    }
    for (const r of exRates) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
      bySymbol[r.symbol].push(r);
    }

    const opps: ArbitrageOpportunity[] = [];
    for (const [symbol, rates] of Object.entries(bySymbol)) {
      if (rates.length < 2) continue;
      let best: ArbitrageOpportunity | null = null;
      for (let i = 0; i < rates.length; i++) {
        for (let j = i + 1; j < rates.length; j++) {
          const a = rates[i], b = rates[j];
          if (a.exchange === b.exchange) continue;
          const spread = Math.abs(a.fundingRate - b.fundingRate);
          const apr = spread * 24 * 365 * 100;
          if (apr < 0.1) continue;

          const longSide = a.fundingRate <= b.fundingRate ? a : b;
          const shortSide = a.fundingRate > b.fundingRate ? a : b;
          const bboSpread = shortSide.askPrice > 0
            ? (longSide.bidPrice / shortSide.askPrice - 1) : 0;

          const opp: ArbitrageOpportunity = {
            symbol, long: longSide, short: shortSide,
            spreadRate: spread, spreadAPR: apr, bboSpread,
            longAction: `LONG on ${longSide.exchange}`,
            shortAction: `SHORT on ${shortSide.exchange}`,
            tier: apr >= 50 ? 'high' : apr >= 20 ? 'medium' : 'low',
            lastSeen: Date.now(),
          };
          if (!best || apr > best.spreadAPR) best = opp;
        }
      }
      if (best) opps.push(best);
    }

    opps.sort((a, b) => b.spreadAPR - a.spreadAPR);
    setOpportunities(opps);
    setLastUpdate(new Date());
    setLoading(false);
    return opps;
  }, [pacificaRates, pacificaPrices]);

  useEffect(() => {
    if (!Object.keys(pacificaRates).length) return;
    compute();
    const iv = window.setInterval(compute, 30000);
    return () => window.clearInterval(iv);
  }, [compute, pacificaRates]);

  return { opportunities, allRates, loading, lastUpdate, errors, refetch: compute, notifiedRef };
}
