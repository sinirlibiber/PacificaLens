'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Calculator, CalcResult } from './Calculator';
import { Results } from './Results';
import { StatsBar } from './StatsBar';
import { AccountTabs } from './AccountTabs';
import { MarketList } from './MarketList';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice, getMarkPrice } from '@/lib/utils';
import { Market, Ticker, FundingRate, Position, AccountInfo, getTradeHistory, getEquityHistory, getFundingHistory, TradeHistory, EquityHistory, FundingHistory } from '@/lib/pacifica';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';

interface RiskManagerProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  fundingRates: Record<string, FundingRate>;
  positions: Position[];
  accountInfo: AccountInfo | null;
  accountSize: number;
  onAccountSizeChange: (v: number) => void;
  wallet: string | null;
  error?: string | null;
  onExecute: (r: CalcResult, symbol: string) => void;
}

type RiskTab = 'results' | 'portfolio';


function ResizablePanels({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState([240, 380]);
  const dragging = useRef<{ col: number; startX: number; startW: number[] } | null>(null);

  function onMouseDown(col: number) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = { col, startX: e.clientX, startW: [...widths] };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return;
      const dx = e.clientX - dragging.current.startX;
      const { col, startW } = dragging.current;
      const containerW = containerRef.current.offsetWidth;
      const newW = [...startW];
      if (col === 0) newW[0] = Math.max(160, Math.min(400, startW[0] + dx));
      else newW[1] = Math.max(280, Math.min(600, startW[1] + dx));
      if (containerW - newW[0] - newW[1] < 240) return;
      setWidths(newW);
    }
    function onUp() {
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      <div style={{ width: widths[0], flexShrink: 0, overflow: 'hidden' }}>{left}</div>
      <div onMouseDown={onMouseDown(0)} className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors" />
      <div style={{ width: widths[1], flexShrink: 0, overflow: 'hidden' }}>{center}</div>
      <div onMouseDown={onMouseDown(1)} className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors" />
      <div className="flex-1 min-w-0 overflow-hidden">{right}</div>
    </div>
  );
}

export function RiskManager({
  markets, tickers, fundingRates, positions, accountInfo,
  accountSize, onAccountSizeChange, wallet, error, onExecute
}: RiskManagerProps) {
  const [activeTab, setActiveTab] = useState<RiskTab>('results');
  const [selected, setSelected] = useState<Market | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());


  useEffect(() => {
    if (!selected && markets.length > 0) setSelected(markets[0]);
  }, [markets, selected]);

  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;
  const portfolioRiskPct = equity > 0 ? Math.min((totalMarginUsed / equity) * 100, 100) : 0;

  const fundingCosts = positions.map(p => {
    const tk = tickers[p.symbol];
    const fr = Number(tk?.funding || 0);
    const size = Number(p.amount || 0);
    const price = getMarkPrice(tk);
    const notional = size * price;
    return {
      symbol: p.symbol,
      side: p.side === 'bid' ? 'Long' : 'Short',
      notional,
      hourly: Math.abs(fr * notional),
      daily: Math.abs(fr * notional * 24),
      weekly: Math.abs(fr * notional * 24 * 7),
      rate: fr * 100,
    };
  });

  const liqDistances = positions.map(p => {
    const tk = tickers[p.symbol];
    const markPx = getMarkPrice(tk);
    const entryPx = Number(p.entry_price || 0);
    const liqPx = Number((p as { liquidation_price?: string }).liquidation_price || 0);
    const dist = liqPx > 0 ? Math.abs((markPx - liqPx) / markPx * 100) : null;
    const pnlPct = entryPx > 0 ? ((markPx - entryPx) / entryPx * 100) * (p.side === 'bid' ? 1 : -1) : 0;
    return { symbol: p.symbol, side: p.side === 'bid' ? 'Long' : 'Short', markPx, liqPx, dist, pnlPct };
  });

  const wins = closed.filter(j => j.result === 'win').length;
  const winRate = closed.length > 0 ? (wins / closed.length * 100) : 0;
  const totalPnl = closed.reduce((s, j) => s + (j.pnl || 0), 0);
    ? journal.reduce((s, j) => {
        const reward = Math.abs(j.tp - j.entry);
        const risk = Math.abs(j.riskAmt);
        return s + (risk > 0 ? reward / risk : 0);
      }, 0) / journal.length
    : 0;






  const rightTabs: { key: RiskTab; label: string }[] = [
    { key: 'results', label: 'Results' },
    { key: 'portfolio', label: 'Portfolio Heat Map' },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <StatsBar accountInfo={accountInfo} positions={positions} accountSize={accountSize} />

      <ResizablePanels
        left={
          <div className="flex flex-col overflow-hidden h-full">
            <MarketList
              markets={markets} tickers={tickers} selected={selected}
              onSelect={m => { setSelected(m); setResult(null); }} error={error}
            />
          </div>
        }
        center={
          <div className="flex flex-col overflow-hidden h-full border-x border-border1">
            <Calculator
              market={selected}
              ticker={selected ? tickers[selected.symbol] : undefined}
              funding={selected ? fundingRates[selected.symbol] : undefined}
              accountSize={accountSize}
              onAccountSizeChange={onAccountSizeChange}
              onResult={setResult}
              onExecute={r => onExecute(r, selected?.symbol || '')}
              walletConnected={!!wallet}
            />
          </div>
        }
        right={
          <div className="flex-1 flex flex-col overflow-hidden h-full">
          <div className="flex border-b border-border1 bg-surface shrink-0 px-2">
            {rightTabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={'px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-all whitespace-nowrap ' +
                  (activeTab === t.key ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Results */}
          {activeTab === 'results' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <Results
                result={result} positions={positions} accountInfo={accountInfo}
                accountSize={accountSize} onExecute={r => onExecute(r, selected?.symbol || '')}
                walletConnected={!!wallet} market={selected?.symbol || ''}
              />
            </div>
          )}

          {/* Portfolio Heat */}
          {activeTab === 'portfolio' && (
            <div className="flex-1 overflow-auto p-4 bg-bg space-y-4">
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Portfolio Risk', value: fmt(portfolioRiskPct, 1) + '%', color: portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger', icon: portfolioRiskPct < 10 ? '✓' : portfolioRiskPct < 25 ? '⚠' : '⚡' },
                  { label: 'Margin Used', value: '$' + fmt(totalMarginUsed, 2), color: 'text-text1', icon: '◈' },
                  { label: 'Positions', value: String(positions.length), color: positions.length > 0 ? 'text-accent' : 'text-text3', icon: '◉' },
                ].map(s => (
                  <div key={s.label} className="bg-surface rounded-xl border border-border1 p-3.5 shadow-card">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] text-text3 uppercase font-semibold tracking-wide">{s.label}</span>
                      <span className={'text-[14px] ' + s.color}>{s.icon}</span>
                    </div>
                    <div className={'text-[22px] font-bold ' + s.color}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Risk gradient bar */}
              <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[12px] font-semibold text-text2">Risk Exposure</span>
                  <span className={'text-[15px] font-bold ' + (portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger')}>
                    {fmt(portfolioRiskPct, 1)}%
                  </span>
                </div>
                <div className="relative h-4 bg-gradient-to-r from-success via-warn to-danger rounded-full">
                  <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-2 border-text2 rounded-full shadow-md transition-all"
                    style={{ left: 'calc(' + Math.min(portfolioRiskPct * 2, 96) + '% - 10px)' }} />
                </div>
                <div className="flex justify-between text-[10px] text-text3 mt-1.5">
                  <span className="text-success font-semibold">Safe &lt;10%</span>
                  <span className="text-warn font-semibold">Moderate 10-25%</span>
                  <span className="text-danger font-semibold">High &gt;25%</span>
                </div>
              </div>

              {/* Position bubbles */}
              {positions.length > 0 ? (
                <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                  <div className="text-[12px] font-semibold text-text2 mb-4">Position Heat Map</div>
                  <div className="flex flex-wrap gap-3 justify-center">
                    {positions.map(p => {
                      const tk = tickers[p.symbol];
                      const size = Number(p.amount || 0) * getMarkPrice(tk);
                      const maxSize = Math.max(...positions.map(pos => Number(pos.amount || 0) * getMarkPrice(tickers[pos.symbol])));
                      const relSize = maxSize > 0 ? (size / maxSize) : 0;
                      const isLong = p.side === 'bid';
                      const diameter = Math.max(60, relSize * 120);
                      return (
                        <div key={p.symbol} className="flex flex-col items-center gap-1">
                          <div className="rounded-full flex flex-col items-center justify-center border-2 transition-all"
                            style={{
                              width: diameter, height: diameter,
                              background: isLong ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                              borderColor: isLong ? '#10b981' : '#ef4444',
                            }}>
                            <CoinLogo symbol={p.symbol} size={Math.max(16, diameter * 0.3)} />
                            <span className="text-[9px] font-bold text-text1 mt-0.5">{p.symbol}</span>
                          </div>
                          <span className={'text-[10px] font-bold ' + (isLong ? 'text-success' : 'text-danger')}>
                            {isLong ? '↑ LONG' : '↓ SHORT'}
                          </span>
                          <span className="text-[10px] text-text3 font-mono">${fmt(size, 0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-surface rounded-xl border border-border1 border-dashed p-12 text-center text-text3">
                  <div className="text-3xl mb-2">◉</div>
                  <p className="text-sm font-semibold text-text2">No open positions</p>
                  <p className="text-xs mt-1">Open positions will appear here as bubbles</p>
                </div>
              )}
            </div>
          )}

          </div>
        </div>}
      />

      <AccountTabs positions={positions} tickers={tickers} wallet={wallet ?? null} />
    </div>
  );
}
