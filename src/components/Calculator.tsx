'use client';

import { useState, useEffect, useRef } from 'react';
import { Market, Ticker, FundingRate } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmtPrice, fmt, getMarkPrice, get24hChange } from '@/lib/utils';

export interface CalcResult {
  riskAmount: number; positionSize: number; positionValue: number;
  requiredMargin: number; marginPct: number; slPct: number;
  liquidationPrice: number; tp2: number; tp3: number; side: 'long' | 'short';
}

interface CalculatorProps {
  market: Market | null; ticker: Ticker | undefined; funding: FundingRate | undefined;
  accountSize: number; onAccountSizeChange: (v: number) => void;
  onResult: (r: CalcResult | null) => void; onExecute: (r: CalcResult) => void; walletConnected: boolean;
}

// Mini price level visualizer
function PriceLevelBar({ entry, sl, tp, liq, side }: { entry: number; sl: number; tp: number; liq: number; side: 'long' | 'short' }) {
  if (!entry || !sl || !tp) return null;
  const prices = [sl, liq, entry, tp].filter(Boolean).sort((a, b) => a - b);
  const min = Math.min(...prices) * 0.998;
  const max = Math.max(...prices) * 1.002;
  const range = max - min;
  const pct = (p: number) => ((p - min) / range) * 100;

  const levels = [
    { price: liq, label: 'Liq', color: '#ef4444', pct: pct(liq) },
    { price: sl, label: 'SL', color: '#f97316', pct: pct(sl) },
    { price: entry, label: 'Entry', color: '#00b4d8', pct: pct(entry) },
    { price: tp, label: 'TP', color: '#10b981', pct: pct(tp) },
  ].filter(l => l.price > 0).sort((a, b) => a.pct - b.pct);

  return (
    <div className="bg-surface2 rounded-xl border border-border1 p-3 mt-1">
      <div className="text-[9px] text-text3 uppercase font-semibold mb-2">Price Levels</div>
      <div className="relative h-6 rounded-full overflow-hidden bg-border1">
        {/* SL → Entry zone (red) */}
        <div className="absolute h-full bg-danger/20" style={{
          left: side === 'long' ? pct(sl) + '%' : pct(entry) + '%',
          width: Math.abs(pct(entry) - pct(sl)) + '%'
        }} />
        {/* Entry → TP zone (green) */}
        <div className="absolute h-full bg-success/20" style={{
          left: side === 'long' ? pct(entry) + '%' : pct(tp) + '%',
          width: Math.abs(pct(tp) - pct(entry)) + '%'
        }} />
        {/* Price markers */}
        {levels.map(l => (
          <div key={l.label} className="absolute top-0 bottom-0 w-0.5" style={{ left: l.pct + '%', background: l.color }} />
        ))}
      </div>
      <div className="flex justify-between mt-2">
        {levels.map(l => (
          <div key={l.label} className="text-center">
            <div className="text-[9px] font-bold" style={{ color: l.color }}>{l.label}</div>
            <div className="text-[9px] text-text3 font-mono">${fmtPrice(l.price)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Calculator({ market, ticker, funding, accountSize, onAccountSizeChange, onResult, onExecute, walletConnected }: CalculatorProps) {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [riskPct, setRiskPct] = useState(2);
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [error, setError] = useState('');
  const [result, setLocalResult] = useState<CalcResult | null>(null);
  const prevSymbolRef = useRef<string | null>(null);

  const price = getMarkPrice(ticker);
  const change = get24hChange(ticker);
  const fundingRate = funding ? Number(funding.funding_rate) : Number(ticker?.funding || 0);
  const maxLev = market?.max_leverage || 50;

  useEffect(() => {
    if (!market) return;
    if (prevSymbolRef.current !== market.symbol) {
      prevSymbolRef.current = market.symbol;
      if (price > 0) {
        setEntryPrice(price >= 1000 ? price.toFixed(2) : price >= 1 ? price.toFixed(4) : price.toFixed(6));
        setStopLoss('');
        setLocalResult(null);
        onResult(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.symbol]);

  function calculate() {
    setError('');
    const acc = Number(accountSize), entry = Number(entryPrice), sl = Number(stopLoss);
    if (!acc || acc <= 0) return setError('Enter account size');
    if (!entry || entry <= 0) return setError('Enter entry price');
    if (!sl || sl <= 0) return setError('Enter stop loss');
    if (side === 'long' && sl >= entry) return setError('SL must be below entry for LONG');
    if (side === 'short' && sl <= entry) return setError('SL must be above entry for SHORT');
    const riskAmount = acc * (riskPct / 100);
    const slDistance = Math.abs(entry - sl);
    const positionSize = riskAmount / slDistance;
    const positionValue = positionSize * entry;
    const requiredMargin = positionValue / leverage;
    const marginPct = (requiredMargin / acc) * 100;
    const slPct = (slDistance / entry) * 100;
    const liqDistance = entry / leverage;
    const liquidationPrice = side === 'long' ? entry - liqDistance : entry + liqDistance;
    const tp2 = side === 'long' ? entry + slDistance * 2 : entry - slDistance * 2;
    const tp3 = side === 'long' ? entry + slDistance * 3 : entry - slDistance * 3;
    const r = { riskAmount, positionSize, positionValue, requiredMargin, marginPct, slPct, liquidationPrice, tp2, tp3, side };
    setLocalResult(r);
    onResult(r);
  }

  // Live risk amount preview
  const liveRiskAmt = accountSize * (riskPct / 100);
  const riskColor = riskPct <= 2 ? 'text-success' : riskPct <= 5 ? 'text-warn' : 'text-danger';

  return (
    <div className="flex flex-col overflow-y-auto bg-bg h-full">
      {/* Coin header */}
      {market && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border1 bg-surface shrink-0">
          <CoinLogo symbol={market.symbol} size={32} />
          <div className="flex-1">
            <div className="font-bold text-[14px] text-text1 leading-none">{market.symbol}-PERP</div>
            <div className="text-[10px] text-text3 mt-0.5">Max {maxLev}x leverage</div>
          </div>
          <div className="text-right">
            <div className={`text-[18px] font-bold ${change >= 0 ? 'text-success' : 'text-danger'}`}>${fmtPrice(price)}</div>
            <div className="flex items-center gap-2 justify-end mt-0.5">
              <span className={`text-[10px] font-semibold ${change >= 0 ? 'text-success' : 'text-danger'}`}>
                {change >= 0 ? '+' : ''}{fmt(change, 2)}%
              </span>
              {fundingRate !== 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${fundingRate >= 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                  FR {fundingRate >= 0 ? '+' : ''}{fmt(fundingRate * 100, 4)}%
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-[10px] font-bold tracking-widest text-text3 uppercase">Position Calculator</div>

        {/* Direction */}
        <div className="grid grid-cols-2 rounded-xl overflow-hidden border border-border1 shadow-card">
          <button onClick={() => setSide('long')}
            className={`py-2.5 text-[13px] font-bold transition-all flex items-center justify-center gap-1.5 ${side === 'long' ? 'bg-success text-white' : 'bg-surface text-text3 hover:bg-surface2'}`}>
            <span>↑</span> LONG
          </button>
          <button onClick={() => setSide('short')}
            className={`py-2.5 text-[13px] font-bold transition-all flex items-center justify-center gap-1.5 ${side === 'short' ? 'bg-danger text-white' : 'bg-surface text-text3 hover:bg-surface2'}`}>
            <span>↓</span> SHORT
          </button>
        </div>

        {/* Account size */}
        <div>
          <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide block mb-1.5">Account Size</label>
          <div className="relative">
            <input type="number" className="w-full bg-surface border border-border1 rounded-xl px-3 py-2.5 pr-14 text-[13px] text-text1 outline-none focus:border-accent transition-all"
              placeholder="10000" value={accountSize || ''} onChange={e => onAccountSizeChange(Number(e.target.value))} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text3 font-mono">USDC</span>
          </div>
        </div>

        {/* Risk per trade */}
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide">Risk Per Trade</label>
            <div className="flex items-center gap-2">
              {accountSize > 0 && <span className={`text-[11px] font-mono ${riskColor}`}>${fmt(liveRiskAmt, 2)}</span>}
              <span className={`text-[12px] font-bold ${riskColor}`}>{riskPct}%</span>
            </div>
          </div>
          <input type="range" min="0.5" max="10" step="0.5" value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} />
          <div className="flex justify-between text-[9px] mt-1">
            <span className="text-success">0.5% Safe</span>
            <span className="text-warn">5% Moderate</span>
            <span className="text-danger">10% High</span>
          </div>
          {/* Risk meter bar */}
          <div className="mt-2 h-1.5 bg-gradient-to-r from-success via-warn to-danger rounded-full relative">
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-text2 rounded-full shadow transition-all"
              style={{ left: `calc(${((riskPct - 0.5) / 9.5) * 100}% - 6px)` }} />
          </div>
        </div>

        {/* Entry + SL */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'Entry Price', value: entryPrice, onChange: setEntryPrice, placeholder: fmtPrice(price), hint: 'Mark' as const },
            { label: 'Stop Loss', value: stopLoss, onChange: setStopLoss, placeholder: '0.00', hint: null },
          ].map(f => (
            <div key={f.label}>
              <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide block mb-1.5">{f.label}</label>
              <div className="relative">
                <input type="number" className="w-full bg-surface border border-border1 rounded-xl px-3 py-2.5 pr-8 text-[13px] text-text1 outline-none focus:border-accent transition-all"
                  placeholder={f.placeholder} value={f.value} onChange={e => f.onChange(e.target.value)} />
                {f.hint && (
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-accent font-bold hover:underline"
                    onClick={() => setEntryPrice(price >= 1000 ? price.toFixed(2) : price.toFixed(4))}>
                    Mark
                  </button>
                )}
                {!f.hint && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text3">$</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Price level visualizer */}
        {entryPrice && stopLoss && result && (
          <PriceLevelBar
            entry={Number(entryPrice)} sl={Number(stopLoss)}
            tp={result.tp2} liq={result.liquidationPrice} side={side}
          />
        )}

        {/* Leverage */}
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide">Leverage</label>
            <span className={`text-[12px] font-bold ${leverage > maxLev * 0.7 ? 'text-danger' : leverage > maxLev * 0.4 ? 'text-warn' : 'text-accent'}`}>
              {leverage}x
            </span>
          </div>
          <input type="range" min="1" max={maxLev} step="1" value={leverage} onChange={e => setLeverage(Number(e.target.value))} />
          <div className="flex justify-between text-[9px] mt-1">
            <span className="text-text3">1x</span>
            {[Math.round(maxLev * 0.25), Math.round(maxLev * 0.5), Math.round(maxLev * 0.75)].map(v => (
              <button key={v} onClick={() => setLeverage(v)} className="text-text3 hover:text-accent transition-colors">{v}x</button>
            ))}
            <span className={leverage >= maxLev ? 'text-danger font-bold' : 'text-text3'}>{maxLev}x</span>
          </div>
          {leverage > maxLev * 0.7 && (
            <div className="text-[10px] text-danger bg-danger/5 rounded-lg px-2 py-1 mt-1.5">
              ⚠ High leverage — liquidation risk significantly increased
            </div>
          )}
        </div>

        {error && (
          <div className="text-[12px] text-danger bg-danger/5 border border-danger/20 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span>✕</span> {error}
          </div>
        )}

        <button onClick={calculate}
          className="w-full py-3 bg-accent text-white font-bold text-[13px] rounded-xl hover:bg-accent2 transition-colors shadow-card-md tracking-wide">
          CALCULATE POSITION
        </button>

        {/* Quick stats preview */}
        {accountSize > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Max Risk', value: '$' + fmt(liveRiskAmt, 2), color: 'text-danger' },
              { label: 'Leverage', value: leverage + 'x', color: leverage > 20 ? 'text-danger' : 'text-accent' },
              { label: 'Funding/8h', value: (fundingRate >= 0 ? '+' : '') + fmt(fundingRate * 100, 4) + '%', color: fundingRate >= 0 ? 'text-danger' : 'text-success' },
            ].map(s => (
              <div key={s.label} className="bg-surface rounded-xl border border-border1 p-2.5 text-center">
                <div className="text-[9px] text-text3 uppercase font-semibold mb-1">{s.label}</div>
                <div className={'text-[12px] font-bold ' + s.color}>{s.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
