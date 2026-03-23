'use client';

import { useState, useEffect, useRef } from 'react';
import { Calculator, CalcResult } from './Calculator';
import { Results } from './Results';
import { StatsBar } from './StatsBar';
import { MarketList } from './MarketList';
import { CoinLogo } from './CoinLogo';
import { fmt, getMarkPrice } from '@/lib/utils';
import { Market, Ticker, FundingRate, Position, AccountInfo } from '@/lib/pacifica';

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
    function onUp() { dragging.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; }
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

// Simple correlation heuristic based on known market groups
const CORR_GROUPS: Record<string, string> = {
  BTC: 'BTC', ETH: 'ETH_GROUP', SOL: 'ALT', BNB: 'ALT', AVAX: 'ALT',
  MATIC: 'ALT', ARB: 'ALT', OP: 'ALT', LINK: 'ALT', DOT: 'ALT',
  ADA: 'ALT', ATOM: 'ALT', NEAR: 'ALT', APT: 'ALT', SUI: 'ALT',
  XRP: 'XRP', DOGE: 'MEME', SHIB: 'MEME', PEPE: 'MEME',
};

function getCorrelationGroup(symbol: string): string {
  for (const [k, v] of Object.entries(CORR_GROUPS)) {
    if (symbol.startsWith(k)) return v;
  }
  return 'ALT';
}

export function RiskManager({
  markets, tickers, fundingRates, positions, accountInfo,
  accountSize, onAccountSizeChange, wallet, error, onExecute,
}: RiskManagerProps) {
  const [activeTab, setActiveTab] = useState<RiskTab>('results');
  const [selected, setSelected] = useState<Market | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);

  useEffect(() => {
    if (!selected && markets.length > 0) setSelected(markets[0]);
  }, [markets, selected]);

  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;
  const portfolioRiskPct = equity > 0 ? Math.min((totalMarginUsed / equity) * 100, 100) : 0;

  // Portfolio analytics
  const longPositions = positions.filter(p => p.side === 'bid');
  const shortPositions = positions.filter(p => p.side === 'ask');
  const totalLongValue = longPositions.reduce((s, p) => s + Number(p.amount || 0) * getMarkPrice(tickers[p.symbol]), 0);
  const totalShortValue = shortPositions.reduce((s, p) => s + Number(p.amount || 0) * getMarkPrice(tickers[p.symbol]), 0);
  const netExposure = totalLongValue - totalShortValue;
  const totalUnrealizedPnl = positions.reduce((s, p) => s + Number(p.unrealized_pnl || 0), 0);

  // Correlation groups among open positions
  const groupCounts: Record<string, { count: number; side: string[] }> = {};
  positions.forEach(p => {
    const g = getCorrelationGroup(p.symbol);
    if (!groupCounts[g]) groupCounts[g] = { count: 0, side: [] };
    groupCounts[g].count++;
    groupCounts[g].side.push(p.side);
  });
  const correlatedGroups = Object.entries(groupCounts).filter(([, v]) => v.count >= 2);

  const rightTabs: { key: RiskTab; label: string }[] = [
    { key: 'results', label: 'Results' },
    { key: 'portfolio', label: 'Portfolio' },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <StatsBar accountInfo={accountInfo} positions={positions} accountSize={accountSize} />

      <ResizablePanels
        left={
          <div className="flex flex-col overflow-hidden h-full">
            <MarketList markets={markets} tickers={tickers} selected={selected} onSelect={m => { setSelected(m); setResult(null); }} error={error} />
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
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-all whitespace-nowrap ${activeTab === t.key ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2'}`}>
                  {t.label}
                  {t.key === 'portfolio' && positions.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] bg-accent/15 text-accent font-bold">{positions.length}</span>
                  )}
                </button>
              ))}
            </div>

            {activeTab === 'results' && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <Results
                  result={result}
                  positions={positions}
                  accountInfo={accountInfo}
                  accountSize={accountSize}
                  onExecute={r => onExecute(r, selected?.symbol || '')}
                  walletConnected={!!wallet}
                  market={selected?.symbol || ''}
                />
              </div>
            )}

            {activeTab === 'portfolio' && (
              <div className="flex-1 overflow-auto p-4 bg-bg space-y-4">

                {/* Summary stats */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: 'Portfolio Risk',
                      value: fmt(portfolioRiskPct, 1) + '%',
                      sub: 'Margin / equity',
                      color: portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger',
                    },
                    {
                      label: 'Unrealized PnL',
                      value: (totalUnrealizedPnl >= 0 ? '+' : '') + '$' + fmt(totalUnrealizedPnl, 2),
                      sub: 'All open positions',
                      color: totalUnrealizedPnl >= 0 ? 'text-success' : 'text-danger',
                    },
                    {
                      label: 'Net Exposure',
                      value: (netExposure >= 0 ? 'Long ' : 'Short ') + '$' + fmt(Math.abs(netExposure), 0),
                      sub: `L: $${fmt(totalLongValue, 0)} / S: $${fmt(totalShortValue, 0)}`,
                      color: Math.abs(netExposure) < 1000 ? 'text-success' : 'text-warn',
                    },
                    {
                      label: 'Positions',
                      value: String(positions.length),
                      sub: `${longPositions.length} long · ${shortPositions.length} short`,
                      color: positions.length > 0 ? 'text-accent' : 'text-text3',
                    },
                  ].map(s => (
                    <div key={s.label} className="bg-surface rounded-xl border border-border1 p-3.5 shadow-card">
                      <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1.5">{s.label}</div>
                      <div className={`text-[18px] font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-[10px] text-text3 mt-0.5">{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Risk exposure bar */}
                <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[12px] font-semibold text-text2">Risk Exposure</span>
                    <span className={`text-[15px] font-bold ${portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger'}`}>
                      {fmt(portfolioRiskPct, 1)}%
                    </span>
                  </div>
                  <div className="relative h-4 bg-gradient-to-r from-success via-warn to-danger rounded-full">
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-2 border-text2 rounded-full shadow-md transition-all"
                      style={{ left: 'calc(' + Math.min(portfolioRiskPct * 2, 96) + '% - 10px)' }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-text3 mt-1.5">
                    <span className="text-success font-semibold">Safe &lt;10%</span>
                    <span className="text-warn font-semibold">Moderate 10-25%</span>
                    <span className="text-danger font-semibold">High &gt;25%</span>
                  </div>
                </div>

                {/* Correlation warnings */}
                {correlatedGroups.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-text3 uppercase tracking-wide">Correlation Alerts</div>
                    {correlatedGroups.map(([group, data]) => {
                      const allSameSide = data.side.every(s => s === data.side[0]);
                      return (
                        <div key={group} className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[11px] ${allSameSide ? 'bg-warn/8 border-warn/25 text-warn' : 'bg-accent/8 border-accent/25 text-accent'}`}>
                          <span className="shrink-0 mt-0.5">{allSameSide ? '⚠' : 'ℹ'}</span>
                          <span>
                            <span className="font-bold">{data.count} {group} positions</span>
                            {allSameSide ? ` — all ${data.side[0] === 'bid' ? 'LONG' : 'SHORT'}, high correlated risk` : ' — mixed direction, partially hedged'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Position bubbles / heat map */}
                {positions.length > 0 ? (
                  <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                    <div className="text-[12px] font-semibold text-text2 mb-1">Position Heat Map</div>
                    <div className="text-[10px] text-text3 mb-4">Size = position value · Color = PnL</div>
                    <div className="flex flex-wrap gap-3 justify-center">
                      {positions.map(p => {
                        const tk = tickers[p.symbol];
                        const size = Number(p.amount || 0) * getMarkPrice(tk);
                        const pnl = Number(p.unrealized_pnl || 0);
                        const maxSize = Math.max(...positions.map(pos => Number(pos.amount || 0) * getMarkPrice(tickers[pos.symbol])));
                        const relSize = maxSize > 0 ? (size / maxSize) : 0;
                        const isLong = p.side === 'bid';
                        const diameter = Math.max(56, relSize * 110);
                        // PnL coloring: green = profitable, red = losing
                        const pnlIntensity = Math.min(Math.abs(pnl) / (size * 0.05 || 1), 1);
                        const bubbleBg = pnl > 0
                          ? `rgba(16,185,129,${0.1 + pnlIntensity * 0.35})`
                          : pnl < 0
                            ? `rgba(239,68,68,${0.1 + pnlIntensity * 0.35})`
                            : isLong ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
                        const borderColor = pnl > 0 ? '#10b981' : pnl < 0 ? '#ef4444' : isLong ? '#10b981' : '#ef4444';

                        return (
                          <div key={p.symbol} className="flex flex-col items-center gap-1">
                            <div
                              title={`${p.symbol} · ${isLong ? 'Long' : 'Short'} · $${fmt(size, 0)} · PnL: ${pnl >= 0 ? '+' : ''}$${fmt(pnl, 2)}`}
                              className="rounded-full flex flex-col items-center justify-center border-2 transition-all hover:scale-105 cursor-default"
                              style={{ width: diameter, height: diameter, background: bubbleBg, borderColor }}
                            >
                              <CoinLogo symbol={p.symbol} size={Math.max(16, diameter * 0.28)} />
                              <span className="text-[9px] font-bold text-text1 mt-0.5">{p.symbol}</span>
                              {pnl !== 0 && (
                                <span className={`text-[8px] font-bold ${pnl > 0 ? 'text-success' : 'text-danger'}`}>
                                  {pnl > 0 ? '+' : ''}${fmt(pnl, 1)}
                                </span>
                              )}
                            </div>
                            <span className={`text-[10px] font-bold ${isLong ? 'text-success' : 'text-danger'}`}>
                              {isLong ? '↑ L' : '↓ S'}
                            </span>
                            <span className="text-[10px] text-text3 font-mono">${fmt(size, 0)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-surface rounded-xl border border-dashed border-border2 p-12 text-center text-text3">
                    <div className="text-3xl mb-2">◉</div>
                    <p className="text-sm font-semibold text-text2">No open positions</p>
                    <p className="text-xs mt-1">Open positions will appear here as bubbles</p>
                    <p className="text-xs mt-0.5 text-text3">Size = value · Color = PnL</p>
                  </div>
                )}

                {/* Net exposure breakdown */}
                {positions.length > 0 && (
                  <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                    <div className="text-[12px] font-semibold text-text2 mb-3">Long / Short Breakdown</div>
                    <div className="space-y-2">
                      {/* Net exposure bar */}
                      <div className="flex h-3 rounded-full overflow-hidden bg-surface2">
                        {totalLongValue + totalShortValue > 0 && (
                          <>
                            <div className="bg-success/70 transition-all" style={{ width: `${(totalLongValue / (totalLongValue + totalShortValue)) * 100}%` }} />
                            <div className="bg-danger/70 flex-1 transition-all" />
                          </>
                        )}
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success/70 inline-block" />Long <span className="font-bold text-success">${fmt(totalLongValue, 0)}</span></span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger/70 inline-block" />Short <span className="font-bold text-danger">${fmt(totalShortValue, 0)}</span></span>
                      </div>
                      <div className={`text-center text-[12px] font-bold ${Math.abs(netExposure) < 500 ? 'text-success' : 'text-warn'}`}>
                        Net: {netExposure >= 0 ? 'Long' : 'Short'} ${fmt(Math.abs(netExposure), 0)}
                        {Math.abs(netExposure) < 500 && <span className="text-[10px] text-success ml-2">✓ Nearly hedged</span>}
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
