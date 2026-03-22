'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Market, Ticker, getRecentTrades, Trade } from '@/lib/pacifica';
import { getMarkPrice, get24hChange, fmt } from '@/lib/utils';

export interface WhaleTrade {
  id: string;
  symbol: string;
  side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  cause: string;
  price: number;
  amount: number;
  notional: number;
  ts: number;
  isLiquidation: boolean;
}

export interface SymbolPressure {
  symbol: string;
  bullScore: number;    // 0-100
  bearScore: number;
  longNotional: number;
  shortNotional: number;
  liqLong: number;
  liqShort: number;
  oiChange: number;    // % change
  fundingSpike: boolean;
  totalWhaleFlow: number;
  tradeCount: number;
}

export interface OIAlert {
  symbol: string;
  changePercent: number;
  direction: 'up' | 'down';
  ts: number;
}

export interface FundingAlert {
  symbol: string;
  rate: number;
  ts: number;
}

export function useWhaleWatcher(
  markets: Market[],
  tickers: Record<string, Ticker>,
  whaleThreshold: number = 50000
) {
  const [whaleTrades, setWhaleTrades] = useState<WhaleTrade[]>([]);
  const [pressureMap, setPressureMap] = useState<Record<string, SymbolPressure>>({});
  const [oiAlerts, setOiAlerts] = useState<OIAlert[]>([]);
  const [fundingAlerts, setFundingAlerts] = useState<FundingAlert[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const prevOI = useRef<Record<string, number>>({});
  const prevFunding = useRef<Record<string, number>>({});
  const seenTrades = useRef<Set<string>>(new Set());


  const scan = useCallback(async () => {
    if (!markets.length) return;
    setIsScanning(true);

    // Top 20 markets by volume for scanning
    const topMarkets = [...markets]
      .sort((a, b) => Number(tickers[b.symbol]?.volume_24h || 0) - Number(tickers[a.symbol]?.volume_24h || 0))
      .slice(0, 20);

    // Fetch trades for top markets in parallel (batches of 5)
    const newTrades: WhaleTrade[] = [];
    const newPressure: Record<string, SymbolPressure> = {};

    const batch = async (batch: Market[]) => {
      const results = await Promise.allSettled(
        batch.map(m => getRecentTrades(m.symbol).then(trades => ({ symbol: m.symbol, trades })))
      );
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { symbol, trades } = r.value;
        const price = getMarkPrice(tickers[symbol]);

        let longNot = 0, shortNot = 0, liqLong = 0, liqShort = 0, count = 0;

        for (const t of trades) {
          const amount = Number(t.amount || 0);
          const tprice = Number(t.price || price);
          const notional = amount * tprice;
          const isLiq = t.cause === 'market_liquidation' || t.cause === 'backstop_liquidation';
          const isLong = t.side.includes('long');
          const isOpen = t.side.startsWith('open');

          if (isOpen && isLong) longNot += notional;
          if (isOpen && !isLong) shortNot += notional;
          if (isLiq && isLong) liqLong += notional;
          if (isLiq && !isLong) liqShort += notional;

          // Add liquidations always (any size), whale trades above threshold
          const addThis = isLiq || notional >= whaleThreshold;
          if (addThis) {
            if (notional >= whaleThreshold) count++;
            const tradeId = `${symbol}-${t.price}-${t.amount}-${t.created_at}`;
            if (!seenTrades.current.has(tradeId)) {
              seenTrades.current.add(tradeId);
              const wt: WhaleTrade = {
                id: tradeId,
                symbol,
                side: t.side as WhaleTrade['side'],
                cause: t.cause,
                price: tprice,
                amount,
                notional,
                ts: (typeof t.created_at === 'number' && t.created_at > 1e12) ? t.created_at : (new Date(t.created_at).getTime() || Date.now()),
                isLiquidation: isLiq,
              };
              newTrades.push(wt);
            }
          }
        }

        const totalWhale = longNot + shortNot;
        const bullScore = totalWhale > 0 ? Math.round((longNot / totalWhale) * 100) : 50;
        const fr = Number(tickers[symbol]?.funding || 0) * 100;
        const prevFR = prevFunding.current[symbol] ?? fr;
        const fundingSpike = Math.abs(fr - prevFR) > 0.01;
        prevFunding.current[symbol] = fr;

        newPressure[symbol] = {
          symbol,
          bullScore,
          bearScore: 100 - bullScore,
          longNotional: longNot,
          shortNotional: shortNot,
          liqLong,
          liqShort,
          oiChange: 0,
          fundingSpike,
          totalWhaleFlow: totalWhale,
          tradeCount: count,
        };
      }
    };

    // 4 batches of 5
    for (let i = 0; i < topMarkets.length; i += 5) {
      await batch(topMarkets.slice(i, i + 5));
    }

    // OI change detection - track all markets from tickers
    const newOiAlerts: OIAlert[] = [];
    for (const m of markets) {
      const oi = Number(tickers[m.symbol]?.open_interest || 0);
      if (oi <= 0) { prevOI.current[m.symbol] = oi; continue; }
      const prev = prevOI.current[m.symbol];
      if (prev && prev > 0 && prev !== oi) {
        const changePct = ((oi - prev) / prev) * 100;
        if (Math.abs(changePct) >= 2) { // lower threshold to 2%
          newOiAlerts.push({
            symbol: m.symbol,
            changePercent: changePct,
            direction: changePct > 0 ? 'up' : 'down',
            ts: Date.now(),
          });
          if (newPressure[m.symbol]) newPressure[m.symbol].oiChange = changePct;
          else newPressure[m.symbol] = { symbol: m.symbol, bullScore: 50, bearScore: 50, longNotional: 0, shortNotional: 0, liqLong: 0, liqShort: 0, oiChange: changePct, fundingSpike: false, totalWhaleFlow: 0, tradeCount: 0 };
        }
      }
      prevOI.current[m.symbol] = oi;
    }

    // Funding spike alerts - show all markets with notable funding
    const newFundingAlerts: FundingAlert[] = [];
    for (const m of markets) {
      const fr = Number(tickers[m.symbol]?.funding || 0) * 100;
      if (Math.abs(fr) >= 0.01) { // lower threshold to show more
        newFundingAlerts.push({ symbol: m.symbol, rate: fr, ts: Date.now() });
      }
    }
    newFundingAlerts.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));

    // Commit state
    if (newTrades.length > 0) {
      setWhaleTrades(prev => [...newTrades, ...prev].slice(0, 200));
    }
    setPressureMap(prev => ({ ...prev, ...newPressure }));
    if (newOiAlerts.length > 0) setOiAlerts(prev => [...newOiAlerts, ...prev].slice(0, 50));
    setFundingAlerts(newFundingAlerts.slice(0, 20));
    setLastScan(new Date());
    setIsScanning(false);
  }, [markets, tickers, whaleThreshold]);

  useEffect(() => {
    if (!markets.length) return;
    // Initial scan after short delay
    const t = window.setTimeout(() => scan(), 1000);
    const iv = window.setInterval(scan, 15000); // every 15s
    return () => { window.clearTimeout(t); window.clearInterval(iv); };
  }, [scan, markets.length]);

  return { whaleTrades, pressureMap, oiAlerts, fundingAlerts, isScanning, lastScan, scan };
}
