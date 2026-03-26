'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Market, Ticker, FundingRate } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmtPrice, fmt, getMarkPrice, get24hChange } from '@/lib/utils';

export interface CalcResult {
  riskAmount: number; positionSize: number; positionValue: number;
  requiredMargin: number; marginPct: number; slPct: number;
  liquidationPrice: number;
  tp1: number; tp2: number; tp3: number;
  rrRatio: number;
  fundingCostDaily: number; fundingCostWeekly: number;
  breakEvenPrice: number;
  side: 'long' | 'short';
  leverage: number;
  entryPrice: number; stopLoss: number;
  orderType?: 'market' | 'limit';
}

interface CalculatorProps {
  market: Market | null; ticker: Ticker | undefined; funding: FundingRate | undefined;
  accountSize: number; onAccountSizeChange: (v: number) => void;
  onResult: (r: CalcResult | null) => void; onExecute: (r: CalcResult) => void; walletConnected: boolean;
}

function PriceLevelBar({ entry, sl, tp, liq, side }: { entry: number; sl: number; tp: number; liq: number; side: 'long' | 'short' }) {
  if (!entry || !sl || !tp) return null;
  const pts = [liq, sl, entry, tp].filter(v => v > 0);
  const min = Math.min(...pts) * 0.997;
  const max = Math.max(...pts) * 1.003;
  const range = max - min || 1;
  const pct = (p: number) => Math.max(0, Math.min(100, ((p - min) / range) * 100));
  const levels = [
    { price: liq, label: 'Liq', color: '#ef4444' },
    { price: sl, label: 'SL', color: '#f97316' },
    { price: entry, label: 'Entry', color: '#00b4d8' },
    { price: tp, label: 'TP', color: '#10b981' },
  ].filter(l => l.price > 0).sort((a, b) => a.price - b.price);
  const slPct = pct(sl), entryPct = pct(entry), tpPct = pct(tp);
  return (
    <div className="bg-surface2 rounded-xl border border-border1 p-3">
      <div className="text-[9px] text-text3 uppercase font-semibold mb-2 tracking-wide">Price Levels</div>
      <div className="relative h-5 rounded-full overflow-hidden bg-border1/60">
        <div className="absolute h-full bg-danger/25 transition-all" style={{ left: side === 'long' ? slPct + '%' : entryPct + '%', width: Math.abs(entryPct - slPct) + '%' }} />
        <div className="absolute h-full bg-success/25 transition-all" style={{ left: side === 'long' ? entryPct + '%' : tpPct + '%', width: Math.abs(tpPct - entryPct) + '%' }} />
        {levels.map(l => <div key={l.label} className="absolute top-0 bottom-0 w-[2px]" style={{ left: pct(l.price) + '%', background: l.color }} />)}
      </div>
      <div className="flex justify-between mt-1.5">
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

const FEE_RATE = 0.0002;

function computeResult(
  accountSize: number, entryPrice: string, stopLoss: string, takeProfit: string,
  side: 'long' | 'short', leverage: number, riskPct: number, rrRatio: number, fundingRate: number
): CalcResult | null {
  const acc = Number(accountSize), entry = Number(entryPrice), sl = Number(stopLoss), tp = Number(takeProfit);
  if (!acc || acc <= 0 || !entry || entry <= 0 || !sl || sl <= 0) return null;
  if (side === 'long' && sl >= entry) return null;
  if (side === 'short' && sl <= entry) return null;
  if (tp > 0) {
    if (side === 'long' && tp <= entry) return null;
    if (side === 'short' && tp >= entry) return null;
  }
  const riskAmount = acc * (riskPct / 100);
  const slDistance = Math.abs(entry - sl);
  const positionSize = riskAmount / slDistance;
  const positionValue = positionSize * entry;
  const requiredMargin = positionValue / leverage;
  const marginPct = (requiredMargin / acc) * 100;
  const slPct = (slDistance / entry) * 100;
  const liqDistance = entry / leverage;
  const liquidationPrice = side === 'long' ? entry - liqDistance : entry + liqDistance;
  const tp1 = tp > 0 ? tp : (side === 'long' ? entry + slDistance * rrRatio : entry - slDistance * rrRatio);
  const tp2 = side === 'long' ? entry + slDistance * 2 : entry - slDistance * 2;
  const tp3 = side === 'long' ? entry + slDistance * 3 : entry - slDistance * 3;
  const fundingCostDaily = Math.abs(fundingRate) * positionValue * 3;
  const fundingCostWeekly = fundingCostDaily * 7;
  const feeCost = positionValue * FEE_RATE * 2;
  const breakEvenMove = feeCost / positionSize;
  const breakEvenPrice = side === 'long' ? entry + breakEvenMove : entry - breakEvenMove;
  const actualRr = tp > 0 ? Math.abs(tp - entry) / slDistance : rrRatio;
  return { riskAmount, positionSize, positionValue, requiredMargin, marginPct, slPct, liquidationPrice, tp1, tp2, tp3, rrRatio: actualRr, fundingCostDaily, fundingCostWeekly, breakEvenPrice, side, leverage, entryPrice: entry, stopLoss: sl };
}

export function Calculator({ market, ticker, funding, accountSize, onAccountSizeChange, onResult, onExecute, walletConnected }: CalculatorProps) {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [riskPct, setRiskPct] = useState(2);
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [rrRatio, setRrRatio] = useState(2);
  const [tpMode, setTpMode] = useState<'rr' | 'manual'>('rr');
  const [validationError, setValidationError] = useState('');
  const [result, setLocalResult] = useState<CalcResult | null>(null);
  const [lastCalcTime, setLastCalcTime] = useState<number | null>(null);
  const prevSymbolRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const price = getMarkPrice(ticker);
  const change = get24hChange(ticker);
  const fundingRate = funding ? Number(funding.funding_rate) : Number(ticker?.funding || 0);
  const maxLev = market?.max_leverage || 50;

  // Auto-fill entry on market switch
  useEffect(() => {
    if (!market) return;
    if (prevSymbolRef.current !== market.symbol) {
      prevSymbolRef.current = market.symbol;
      if (price > 0) {
        const fmt = price >= 1000 ? price.toFixed(2) : price >= 1 ? price.toFixed(4) : price.toFixed(6);
        setEntryPrice(fmt);
        setStopLoss('');
        setTakeProfit('');
        setLocalResult(null);
        setValidationError('');
        onResult(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.symbol]);

  // Auto-TP in R:R mode
  useEffect(() => {
    if (tpMode !== 'rr') return;
    const entry = Number(entryPrice), sl = Number(stopLoss);
    if (!entry || !sl || sl <= 0) return;
    const dist = Math.abs(entry - sl);
    const tp = side === 'long' ? entry + dist * rrRatio : entry - dist * rrRatio;
    if (tp > 0) setTakeProfit(tp >= 1000 ? tp.toFixed(2) : tp >= 1 ? tp.toFixed(4) : tp.toFixed(6));
  }, [entryPrice, stopLoss, rrRatio, side, tpMode]);

  // Debounced auto-calculate — fires 350ms after any input change
  const autoCalc = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setValidationError('');
      const r = computeResult(accountSize, entryPrice, stopLoss, takeProfit, side, leverage, riskPct, rrRatio, fundingRate);
      if (r) {
        setLocalResult(r);
        onResult(r);
        setLastCalcTime(Date.now());
      } else {
        // Only show error if user has filled in enough fields
        if (entryPrice && stopLoss) {
          const entry = Number(entryPrice), sl = Number(stopLoss);
          if (side === 'long' && sl >= entry) setValidationError('SL must be below entry for LONG');
          else if (side === 'short' && sl <= entry) setValidationError('SL must be above entry for SHORT');
        }
        setLocalResult(null);
        onResult(null);
      }
    }, 350);
  }, [accountSize, entryPrice, stopLoss, takeProfit, side, leverage, riskPct, rrRatio, fundingRate, onResult]);

  useEffect(() => {
    autoCalc();
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [autoCalc]);

  // SL quick presets (% from entry)
  function setSLPreset(pct: number) {
    const entry = Number(entryPrice) || price;
    if (!entry) return;
    const sl = side === 'long' ? entry * (1 - pct / 100) : entry * (1 + pct / 100);
    setStopLoss(sl >= 1000 ? sl.toFixed(2) : sl >= 1 ? sl.toFixed(4) : sl.toFixed(6));
  }

  // Clear all inputs
  function resetInputs() {
    setStopLoss('');
    setTakeProfit('');
    setLocalResult(null);
    setValidationError('');
    onResult(null);
    if (price > 0) setEntryPrice(price >= 1000 ? price.toFixed(2) : price.toFixed(4));
  }

  const liveRiskAmt = accountSize * (riskPct / 100);
  const riskColor = riskPct <= 2 ? 'text-success' : riskPct <= 5 ? 'text-warn' : 'text-danger';
  const levColor = leverage > maxLev * 0.7 ? 'text-danger' : leverage > maxLev * 0.4 ? 'text-warn' : 'text-accent';

  // Format last-calculated timestamp
  const calcAgo = lastCalcTime ? Math.round((Date.now() - lastCalcTime) / 1000) : null;

  return (
    <div className="flex flex-col overflow-hidden bg-bg h-full">
      {market && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border1 bg-surface shrink-0">
          <CoinLogo symbol={market.symbol} size={30} />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[13px] text-text1">{market.symbol}-PERP</div>
            <div className="text-[10px] text-text3">Max {maxLev}x leverage</div>
          </div>
          <div className="text-right">
            <div className={`text-[16px] font-bold ${change >= 0 ? 'text-success' : 'text-danger'}`}>${fmtPrice(price)}</div>
            <div className="flex items-center gap-1.5 justify-end mt-0.5">
              <span className={`text-[10px] font-semibold ${change >= 0 ? 'text-success' : 'text-danger'}`}>{change >= 0 ? '+' : ''}{fmt(change, 2)}%</span>
              {fundingRate !== 0 && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${fundingRate >= 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                  FR {fundingRate >= 0 ? '+' : ''}{fmt(fundingRate * 100, 4)}%
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">

        {/* Direction */}
        <div className="grid grid-cols-2 rounded-xl overflow-hidden border border-border1">
          <button onClick={() => setSide('long')} className={`py-2.5 text-[13px] font-bold transition-all ${side === 'long' ? 'bg-success text-white' : 'bg-surface text-text3 hover:bg-surface2'}`}>↑ LONG</button>
          <button onClick={() => setSide('short')} className={`py-2.5 text-[13px] font-bold transition-all ${side === 'short' ? 'bg-danger text-white' : 'bg-surface text-text3 hover:bg-surface2'}`}>↓ SHORT</button>
        </div>

        {/* Account size */}
        <div>
          <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide block mb-1.5">Account Size</label>
          <div className="relative">
            <input type="number" className="w-full bg-surface border border-border1 rounded-xl px-3 py-2.5 pr-14 text-[13px] text-text1 outline-none focus:border-accent transition-all" placeholder="10000" value={accountSize || ''} onChange={e => onAccountSizeChange(Number(e.target.value))} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-text3 font-mono">USDC</span>
          </div>
        </div>

        {/* Risk % */}
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide">Risk Per Trade</label>
            <div className="flex items-center gap-2">
              {accountSize > 0 && <span className={`text-[11px] font-mono ${riskColor}`}>${fmt(liveRiskAmt, 2)}</span>}
              <span className={`text-[12px] font-bold ${riskColor}`}>{riskPct}%</span>
            </div>
          </div>
          <input type="range" min="0.5" max="10" step="0.5" value={riskPct} onChange={e => setRiskPct(Number(e.target.value))} className="w-full accent-accent" />
          <div className="mt-1.5 h-1.5 bg-gradient-to-r from-success via-warn to-danger rounded-full relative">
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-text2 rounded-full shadow transition-all" style={{ left: `calc(${((riskPct - 0.5) / 9.5) * 100}% - 6px)` }} />
          </div>
          <div className="flex justify-between text-[9px] mt-1 text-text3">
            <span className="text-success">0.5% Safe</span><span className="text-warn">5%</span><span className="text-danger">10% High</span>
          </div>
        </div>

        {/* Entry + SL */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide">Entry Price</label>
              <button onClick={resetInputs} className="text-[9px] text-text3 hover:text-danger transition-colors">✕ reset</button>
            </div>
            <div className="relative">
              <input type="number" className="w-full bg-surface border border-border1 rounded-xl px-3 py-2.5 pr-12 text-[13px] text-text1 outline-none focus:border-accent transition-all" placeholder={fmtPrice(price)} value={entryPrice} onChange={e => setEntryPrice(e.target.value)} />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-accent font-bold hover:underline" onClick={() => setEntryPrice(price >= 1000 ? price.toFixed(2) : price.toFixed(4))}>Mark</button>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide">Stop Loss</label>
            </div>
            <div className="relative">
              <input type="number" className="w-full bg-surface border border-border1 rounded-xl px-3 py-2.5 pr-6 text-[13px] text-text1 outline-none focus:border-danger/60 transition-all" placeholder="0.00" value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-danger">$</span>
            </div>
          </div>
        </div>

        {/* SL Quick Presets */}
        <div>
          <div className="text-[9px] text-text3 font-semibold uppercase tracking-wide mb-1.5">SL Quick Set</div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 5].map(pct => (
              <button
                key={pct}
                onClick={() => setSLPreset(pct)}
                className={`py-1.5 text-[10px] font-semibold rounded-lg border transition-all ${
                  stopLoss && Math.abs(Math.abs(Number(entryPrice) - Number(stopLoss)) / Number(entryPrice) * 100 - pct) < 0.05
                    ? 'bg-danger/10 border-danger/40 text-danger'
                    : 'bg-surface border-border1 text-text3 hover:border-danger/40 hover:text-danger'
                }`}
              >
                -{pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Take Profit */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide">Take Profit</label>
            <div className="flex bg-surface2 border border-border1 rounded-lg overflow-hidden">
              {(['rr', 'manual'] as const).map(m => (
                <button key={m} onClick={() => setTpMode(m)} className={`px-2.5 py-0.5 text-[10px] font-semibold transition-all ${tpMode === m ? 'bg-accent text-white' : 'text-text3 hover:text-text2'}`}>
                  {m === 'rr' ? 'R:R' : 'Manual'}
                </button>
              ))}
            </div>
          </div>
          {tpMode === 'rr' ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-text3">Risk : Reward</span>
                <span className="text-[13px] font-bold text-success">1 : {rrRatio}</span>
              </div>
              <input type="range" min="1" max="10" step="0.5" value={rrRatio} onChange={e => setRrRatio(Number(e.target.value))} className="w-full accent-success" />
              <div className="flex justify-between text-[9px] mt-1 text-text3">
                {[1, 2, 3, 5, 10].map(v => (
                  <button key={v} onClick={() => setRrRatio(v)} className={`transition-colors ${rrRatio === v ? 'text-success font-bold' : 'hover:text-accent'}`}>1:{v}</button>
                ))}
              </div>
              {takeProfit && <div className="text-[10px] text-success mt-1.5 bg-success/5 border border-success/20 rounded-lg px-2.5 py-1">→ TP: ${takeProfit}</div>}
            </div>
          ) : (
            <div className="relative">
              <input type="number" className="w-full bg-surface border border-border1 rounded-xl px-3 py-2.5 pr-6 text-[13px] text-text1 outline-none focus:border-success/60 transition-all" placeholder="0.00" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-success">$</span>
            </div>
          )}
        </div>

        {/* Leverage */}
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-[10px] font-semibold text-text3 uppercase tracking-wide">Leverage</label>
            <span className={`text-[13px] font-bold ${levColor}`}>{leverage}x</span>
          </div>
          <input type="range" min="1" max={maxLev} step="1" value={leverage} onChange={e => setLeverage(Number(e.target.value))} className="w-full accent-accent" />
          <div className="flex justify-between text-[9px] mt-1">
            {[1, Math.round(maxLev * 0.25), Math.round(maxLev * 0.5), Math.round(maxLev * 0.75), maxLev].map(v => (
              <button key={v} onClick={() => setLeverage(v)} className={`transition-colors ${leverage === v ? 'font-bold text-accent' : 'text-text3 hover:text-accent'}`}>{v}x</button>
            ))}
          </div>
          {leverage > maxLev * 0.7 && (
            <div className="text-[10px] text-danger bg-danger/5 border border-danger/20 rounded-lg px-2.5 py-1.5 mt-1.5 flex items-center gap-1.5">
              ⚠ High leverage — liquidation risk significantly increased
            </div>
          )}
        </div>

        {/* Price level bar — live, no button needed */}
        {result && <PriceLevelBar entry={result.entryPrice} sl={result.stopLoss} tp={result.tp1} liq={result.liquidationPrice} side={side} />}

        {/* Validation error */}
        {validationError && (
          <div className="text-[12px] text-danger bg-danger/5 border border-danger/20 rounded-xl px-3 py-2.5 flex items-center gap-2">✕ {validationError}</div>
        )}

        {/* Auto-calc status bar */}
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${result ? 'bg-success' : 'bg-text3'}`} />
            <span className="text-[10px] text-text3">
              {result ? `Auto-calculated${calcAgo !== null && calcAgo < 60 ? ` · ${calcAgo}s ago` : ''}` : 'Fill entry + SL to calculate'}
            </span>
          </div>
          {result && (
            <button
              onClick={() => { if (result) onExecute(result); }}
              disabled={!walletConnected}
              className={`text-[10px] font-bold px-3 py-1 rounded-lg transition-all disabled:opacity-40 ${result.side === 'long' ? 'bg-success/10 text-success hover:bg-success/20' : 'bg-danger/10 text-danger hover:bg-danger/20'}`}
            >
              {walletConnected ? `Place ${result.side.toUpperCase()}` : 'Connect wallet'}
            </button>
          )}
        </div>

        {accountSize > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Max Risk', value: '$' + fmt(liveRiskAmt, 2), color: riskColor },
              { label: 'Leverage', value: leverage + 'x', color: levColor },
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