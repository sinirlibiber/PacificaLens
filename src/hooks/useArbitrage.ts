'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

export interface ExchangeRate {
  exchange: string;
  symbol: string;
  fundingRate: number;    // 8h rate as decimal e.g. 0.0001
  markPrice: number;
  openInterest: number;
  color: string;
  logo: string;
}

export interface ArbitrageOpportunity {
  symbol: string;
  long: ExchangeRate;
  short: ExchangeRate;
  spreadRate: number;    // 8h spread
  spreadAPR: number;     // annualized %
  longAction: string;    // "LONG on Hyperliquid"
  shortAction: string;   // "SHORT on Pacifica"
  tier: 'high' | 'medium' | 'low';
  lastSeen: number;
}

// Normalize symbol: remove -USD, USDT, -PERP suffixes
function normSym(s: string): string {
  return s.replace(/-USD$/, '').replace(/USDT$/, '').replace(/-PERP$/, '')
    .replace(/^k/, '').toUpperCase().trim();
}

async function fetchHyperliquid(): Promise<ExchangeRate[]> {
  try {
    const res = await fetch('/api/hyperliquid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    const data = await res.json();
    // HL returns: [ [meta_array], [ctx_array] ] where each is array of one element
    if (!Array.isArray(data) || data.length < 2) return [];
    const metaArr = Array.isArray(data[0]) ? data[0] : [data[0]];
    const ctxArr = Array.isArray(data[1]) ? data[1] : [data[1]];
    const universe = metaArr[0]?.universe ?? [];
    const ctxs = ctxArr[0] ?? [];
    return universe.map((u: { name: string }, i: number) => {
      const ctx = Array.isArray(ctxs) ? (ctxs[i] ?? {}) : {};
      return {
        exchange: 'Hyperliquid',
        symbol: normSym(u.name),
        fundingRate: Number(ctx.funding ?? 0),
        markPrice: Number(ctx.markPx ?? 0),
        openInterest: Number(ctx.openInterest ?? 0) * Number(ctx.markPx ?? 0),
        color: '#00C2FF',
        logo: '⚡',
      } as ExchangeRate;
    }).filter((r: ExchangeRate) => r.markPrice > 0);
  } catch { return []; }
}

async function fetchAster(): Promise<ExchangeRate[]> {
  try {
    const res = await fetch('/api/aster?path=fapi/v1/premiumIndex');
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: { symbol: string; lastFundingRate: string; markPrice: string }) => ({
      exchange: 'Aster',
      symbol: normSym(d.symbol),
      fundingRate: Number(d.lastFundingRate ?? 0),
      markPrice: Number(d.markPrice ?? 0),
      openInterest: 0,
      color: '#F59E0B',
      logo: '🌟',
    } as ExchangeRate)).filter((r: ExchangeRate) => r.markPrice > 0);
  } catch { return []; }
}

async function fetchDydx(): Promise<ExchangeRate[]> {
  try {
    const res = await fetch('/api/dydx?path=v4/perpetualMarkets');
    const data = await res.json();
    const markets = data?.markets ?? {};
    return Object.values(markets).map((m: unknown) => {
      const market = m as { ticker: string; nextFundingRate: string; oraclePrice: string; openInterest: string; atomicResolution: number; stepBaseQuantums: number };
      return {
        exchange: 'dYdX',
        symbol: normSym(market.ticker),
        fundingRate: Number(market.nextFundingRate ?? 0),
        markPrice: Number(market.oraclePrice ?? 0),
        openInterest: Number(market.openInterest ?? 0),
        color: '#8B5CF6',
        logo: '⚙️',
      } as ExchangeRate;
    }).filter((r: ExchangeRate) => r.markPrice > 0);
  } catch { return []; }
}

async function fetchLighter(): Promise<ExchangeRate[]> {
  try {
    // Use funding-rates endpoint: GET /api/v1/funding-rates
    const res = await fetch('/api/lighter?path=funding-rates');
    const data = await res.json();
    // Response: array of { market_id, symbol, funding_rate, mark_price, ... }
    const rates = data?.funding_rates ?? data?.data ?? data ?? [];
    if (!Array.isArray(rates)) return [];
    return rates
      .map((r: { symbol?: string; market?: string; funding_rate?: string; mark_price?: string; open_interest?: string }) => ({
        exchange: 'Lighter',
        symbol: normSym(r.symbol ?? r.market ?? ''),
        fundingRate: Number(r.funding_rate ?? 0),
        markPrice: Number(r.mark_price ?? 0),
        openInterest: Number(r.open_interest ?? 0),
        color: '#10B981',
        logo: '🔮',
      } as ExchangeRate))
      .filter((r: ExchangeRate) => r.symbol && r.markPrice > 0);
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
    const [hl, aster, dydx, lighter] = await Promise.allSettled([
      fetchHyperliquid(),
      fetchAster(),
      fetchDydx(),
      fetchLighter(),
    ]);

    const newErrors: Record<string, string> = {};
    const exRates: ExchangeRate[] = [];

    if (hl.status === 'fulfilled') exRates.push(...hl.value);
    else newErrors['Hyperliquid'] = 'Fetch failed';
    if (aster.status === 'fulfilled') exRates.push(...aster.value);
    else newErrors['Aster'] = 'Fetch failed';
    if (dydx.status === 'fulfilled') exRates.push(...dydx.value);
    else newErrors['dYdX'] = 'Fetch failed';
    if (lighter.status === 'fulfilled') exRates.push(...lighter.value);
    else newErrors['Lighter'] = 'Fetch failed';

    setErrors(newErrors);
    setAllRates(exRates);

    // Build per-symbol rate map
    const bySymbol: Record<string, ExchangeRate[]> = {};
    // Add Pacifica rates
    for (const [sym, rate] of Object.entries(pacificaRates)) {
      const ns = normSym(sym);
      if (!bySymbol[ns]) bySymbol[ns] = [];
      bySymbol[ns].push({
        exchange: 'Pacifica',
        symbol: ns,
        fundingRate: rate,
        markPrice: pacificaPrices[sym] ?? 0,
        openInterest: 0,
        color: '#00B4D8',
        logo: '🌊',
      });
    }
    for (const r of exRates) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
      bySymbol[r.symbol].push(r);
    }

    const opps: ArbitrageOpportunity[] = [];
    for (const [symbol, rates] of Object.entries(bySymbol)) {
      if (rates.length < 2) continue;
      // Find best pair: max(rate) - min(rate)
      let best: ArbitrageOpportunity | null = null;
      for (let i = 0; i < rates.length; i++) {
        for (let j = i + 1; j < rates.length; j++) {
          const a = rates[i], b = rates[j];
          if (a.exchange === b.exchange) continue;
          const spread = Math.abs(a.fundingRate - b.fundingRate);
          // 8h * 3 * 365 * 100
          const apr = spread * 3 * 365 * 100;
          if (apr < 5) continue; // min 5% APR threshold

          const longSide = a.fundingRate < b.fundingRate ? a : b;  // lower rate = receiver on long
          const shortSide = a.fundingRate > b.fundingRate ? a : b;

          const opp: ArbitrageOpportunity = {
            symbol,
            long: longSide,
            short: shortSide,
            spreadRate: spread,
            spreadAPR: apr,
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
