'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Market, Ticker } from '@/lib/pacifica';

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
  bullScore: number;
  bearScore: number;
  longNotional: number;
  shortNotional: number;
  liqLong: number;
  liqShort: number;
  oiChange: number;
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

const WS_URL = 'wss://ws.pacifica.fi/ws';
const PING_MS = 30_000;
const MAX_TRADES = 500;

export function useWhaleWatcher(
  markets: Market[],
  tickers: Record<string, Ticker>,
  whaleThreshold: number = 10_000,
) {
  const [whaleTrades,   setWhaleTrades  ] = useState<WhaleTrade[]>([]);
  const [pressureMap,   setPressureMap  ] = useState<Record<string, SymbolPressure>>({});
  const [oiAlerts,      setOiAlerts     ] = useState<OIAlert[]>([]);
  const [fundingAlerts, setFundingAlerts] = useState<FundingAlert[]>([]);
  const [isScanning,    setIsScanning   ] = useState(false);
  const [lastScan,      setLastScan     ] = useState<Date | null>(null);

  const wsRef       = useRef<WebSocket | null>(null);
  const pingRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenTrades  = useRef<Set<string>>(new Set());
  const pressureRef = useRef<Record<string, SymbolPressure>>({});
  const prevOI      = useRef<Record<string, number>>({});
  const prevFund    = useRef<Record<string, number>>({});
  const marketsRef  = useRef<Market[]>([]);
  const tickersRef  = useRef<Record<string, Ticker>>({});
  const threshRef   = useRef(whaleThreshold);
  const mountedRef  = useRef(true);

  useEffect(() => { marketsRef.current  = markets;  }, [markets]);
  useEffect(() => { tickersRef.current  = tickers;  }, [tickers]);
  useEffect(() => { threshRef.current   = whaleThreshold; }, [whaleThreshold]);

  /* ── OI + Funding alerts from tickers polling ─────────────── */
  useEffect(() => {
    if (!Object.keys(tickers).length) return;

    const newOiAlerts: OIAlert[] = [];
    for (const m of markets) {
      const oi   = Number(tickers[m.symbol]?.open_interest || 0);
      const prev = prevOI.current[m.symbol];
      if (oi > 0 && prev && prev > 0 && prev !== oi) {
        const pct = ((oi - prev) / prev) * 100;
        if (Math.abs(pct) >= 0.5) {
          newOiAlerts.push({ symbol: m.symbol, changePercent: pct, direction: pct > 0 ? 'up' : 'down', ts: Date.now() });
          const p = pressureRef.current[m.symbol];
          if (p) p.oiChange = pct;
        }
      }
      prevOI.current[m.symbol] = oi;
    }

    const newFundAlerts: FundingAlert[] = [];
    for (const m of markets) {
      const fr = Number(tickers[m.symbol]?.funding || 0) * 100;
      if (Math.abs(fr) >= 0.001) newFundAlerts.push({ symbol: m.symbol, rate: fr, ts: Date.now() });
      prevFund.current[m.symbol] = fr;
    }
    newFundAlerts.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));

    if (newOiAlerts.length) setOiAlerts(prev => [...newOiAlerts, ...prev].slice(0, 50));
    setFundingAlerts(newFundAlerts.slice(0, 20));
  }, [tickers, markets]);

  /* ── WebSocket connection ──────────────────────────────────── */
  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const syms = marketsRef.current.map(m => m.symbol);
    if (!syms.length) return;

    // Close existing
    try { wsRef.current?.close(); } catch {}
    if (pingRef.current)  clearInterval(pingRef.current);
    if (reconnRef.current) clearTimeout(reconnRef.current);

    setIsScanning(true);
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      // Subscribe to ALL markets in one go
      syms.forEach(sym => {
        // Pacifica symbol format: "BTC-USD" → strip "-USD" for WS
        const wsSym = sym.replace(/-USD$/, '');
        ws.send(JSON.stringify({ method: 'subscribe', params: { source: 'trades', symbol: wsSym } }));
      });
      // Heartbeat
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' }));
      }, PING_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      let msg: { channel: string; data: unknown[] };
      try { msg = JSON.parse(event.data as string); } catch { return; }
      if (msg.channel !== 'trades' || !Array.isArray(msg.data)) return;

      const newTrades: WhaleTrade[] = [];
      const pressureUpdates: Record<string, Partial<SymbolPressure>> = {};

      for (const raw of msg.data as {
        h: number; s: string; a: string; p: string;
        d: string; tc: string; t: number;
      }[]) {
        const symbol   = raw.s.includes('-') ? raw.s : raw.s + '-USD';
        const price    = parseFloat(raw.p) || 0;
        const amount   = parseFloat(raw.a) || 0;
        const notional = price * amount;
        const isLiq    = raw.tc === 'market_liquidation' || raw.tc === 'backstop_liquidation' || (typeof raw.tc === 'string' && raw.tc.toLowerCase().includes('liq'));
        const isLong   = raw.d?.includes('long');
        const isOpen   = raw.d?.startsWith('open');

        // Update pressure
        if (!pressureUpdates[symbol]) {
          pressureUpdates[symbol] = { longNotional: 0, shortNotional: 0, liqLong: 0, liqShort: 0, tradeCount: 0 };
        }
        const pu = pressureUpdates[symbol];
        if (isOpen && isLong)  pu.longNotional  = (pu.longNotional  || 0) + notional;
        if (isOpen && !isLong) pu.shortNotional = (pu.shortNotional || 0) + notional;
        if (isLiq && isLong)   pu.liqLong       = (pu.liqLong       || 0) + notional;
        if (isLiq && !isLong)  pu.liqShort      = (pu.liqShort      || 0) + notional;
        if (notional >= threshRef.current) pu.tradeCount = (pu.tradeCount || 0) + 1;

        // Collect liquidations + whale trades
        const addThis = isLiq || notional >= threshRef.current;
        if (addThis) {
          const tradeId = `${symbol}-${raw.h}-${raw.t}`;
          if (!seenTrades.current.has(tradeId)) {
            seenTrades.current.add(tradeId);
            if (seenTrades.current.size > 5000) {
              const first = seenTrades.current.values().next().value;
              if (first) seenTrades.current.delete(first);
            }
            newTrades.push({
              id: tradeId,
              symbol,
              side: raw.d as WhaleTrade['side'],
              cause: raw.tc,
              price,
              amount,
              notional,
              ts: raw.t > 1e12 ? raw.t : raw.t * 1000, // normalize to ms
              isLiquidation: isLiq,
            });
          }
        }
      }

      // Merge pressure
      for (const [sym, update] of Object.entries(pressureUpdates)) {
        const existing = pressureRef.current[sym] ?? {
          symbol: sym, bullScore: 50, bearScore: 50,
          longNotional: 0, shortNotional: 0, liqLong: 0, liqShort: 0,
          oiChange: 0, fundingSpike: false, totalWhaleFlow: 0, tradeCount: 0,
        };
        const merged: SymbolPressure = {
          ...existing,
          longNotional:  (existing.longNotional  || 0) + (update.longNotional  || 0),
          shortNotional: (existing.shortNotional || 0) + (update.shortNotional || 0),
          liqLong:       (existing.liqLong       || 0) + (update.liqLong       || 0),
          liqShort:      (existing.liqShort      || 0) + (update.liqShort      || 0),
          tradeCount:    (existing.tradeCount    || 0) + (update.tradeCount    || 0),
        };
        const total = merged.longNotional + merged.shortNotional;
        merged.totalWhaleFlow = total;
        merged.bullScore = total > 0 ? Math.round((merged.longNotional / total) * 100) : 50;
        merged.bearScore = 100 - merged.bullScore;
        pressureRef.current[sym] = merged;
      }

      if (newTrades.length) {
        setWhaleTrades(prev => [...newTrades, ...prev].slice(0, MAX_TRADES));
        setLastScan(new Date());
        setIsScanning(false);
        setPressureMap({ ...pressureRef.current });

        // Persist liquidations to Supabase for 24h heatmap
        const liqEvents = newTrades
          .filter(t => t.isLiquidation)
          .map(t => ({
            trade_id: t.id,
            symbol:   t.symbol,
            side:     t.side,
            price:    t.price,
            amount:   t.amount,
            notional: t.notional,
            cause:    t.cause,
            ts:       t.ts,
          }));
        if (liqEvents.length > 0) {
          fetch('/api/liquidations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: liqEvents }),
          }).catch(() => {}); // fire-and-forget
        }
      }
    };

    ws.onerror = () => {
      setIsScanning(false);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsScanning(false);
      // Auto-reconnect after 3s
      reconnRef.current = setTimeout(() => {
        if (mountedRef.current && marketsRef.current.length) connect();
      }, 3000);
    };
  }, []); // stable — uses refs internally

  /* ── Start WS when markets are ready ──────────────────────── */
  useEffect(() => {
    if (!markets.length) return;
    connect();
    return () => {
      mountedRef.current = false;
      try { wsRef.current?.close(); } catch {}
      if (pingRef.current)  clearInterval(pingRef.current);
      if (reconnRef.current) clearTimeout(reconnRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.length > 0]); // only re-run when markets go from 0 → loaded

  const scan = useCallback(() => { connect(); }, [connect]);

  return { whaleTrades, pressureMap, oiAlerts, fundingAlerts, isScanning, lastScan, scan };
}
