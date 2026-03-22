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

type RiskTab = 'results' | 'portfolio' | 'journal' | 'alerts' | 'performance';

interface JournalEntry {
  id: string;
  ts: number;
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  tp: number;
  size: number;
  riskAmt: number;
  notes: string;
  result: 'win' | 'loss' | 'open';
  pnl?: number;
}

interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  direction: 'above' | 'below';
  triggered: boolean;
  ts: number;
}


function PerformancePanel({ wallet }: { wallet: string }) {
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([]);
  const [equityHistory, setEquityHistory] = useState<EquityHistory[]>([]);
  const [fundingHistory, setFundingHistory] = useState<FundingHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [th, eh, fh] = await Promise.all([
        getTradeHistory(wallet, 100),
        getEquityHistory(wallet),
        getFundingHistory(wallet),
      ]);
      setTradeHistory(th);
      setEquityHistory(eh);
      setFundingHistory(fh);
      setLoading(false);
    }
    load();
  }, [wallet]);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3">
      <div className="w-5 h-5 border-2 border-border2 border-t-accent rounded-full animate-spin" />
      <span className="text-text3 text-sm">Loading performance data...</span>
    </div>
  );

  const totalPnl = tradeHistory.reduce((s, t) => s + Number(t.realized_pnl || 0), 0);
  const totalFunding = fundingHistory.reduce((s, f) => s + Number(f.amount || 0), 0);
  const totalFees = tradeHistory.reduce((s, t) => s + Number(t.fee || 0), 0);
  const wins = tradeHistory.filter(t => Number(t.realized_pnl || 0) > 0).length;
  const winRate = tradeHistory.length > 0 ? (wins / tradeHistory.length * 100) : 0;

  const equityChartData = equityHistory.map(e => ({
    time: new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    equity: Number(e.equity),
  }));

  return (
    <div className="flex-1 overflow-auto p-4 bg-bg space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Realized PnL', value: (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl, 2), color: totalPnl >= 0 ? 'text-success' : 'text-danger' },
          { label: 'Funding Earned', value: (totalFunding >= 0 ? '+' : '') + '$' + fmt(totalFunding, 2), color: totalFunding >= 0 ? 'text-success' : 'text-danger' },
          { label: 'Total Fees Paid', value: '$' + fmt(totalFees, 2), color: 'text-warn' },
          { label: 'Win Rate', value: fmt(winRate, 1) + '%', color: winRate >= 50 ? 'text-success' : 'text-danger' },
        ].map(s => (
          <div key={s.label} className="bg-surface rounded-xl border border-border1 shadow-card p-3.5">
            <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
            <div className={'text-[18px] font-bold ' + s.color}>{s.value}</div>
            <div className="text-[9px] text-text3 mt-0.5">{tradeHistory.length} trades</div>
          </div>
        ))}
      </div>

      {/* Equity chart */}
      {equityChartData.length > 1 && (
        <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
          <div className="text-[12px] font-semibold text-text2 mb-3">Account Equity History</div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityChartData} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00b4d8" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#00b4d8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={v => '$' + fmt(v, 0)} width={60} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => ['$' + fmt(v, 2), 'Equity']} />
                <Area type="monotone" dataKey="equity" stroke="#00b4d8" strokeWidth={2} fill="url(#equityGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Trade history */}
      <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border1 bg-surface2">
          <div className="text-[12px] font-semibold text-text2">Trade History ({tradeHistory.length})</div>
        </div>
        {tradeHistory.length > 0 ? (
          <div className="overflow-auto" style={{ maxHeight: 300 }}>
            <table className="w-full">
              <thead className="sticky top-0 bg-surface2 border-b border-border1">
                <tr>
                  {['Time', 'Symbol', 'Side', 'Price', 'Size', 'Fee', 'Realized PnL'].map(h => (
                    <th key={h} className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeHistory.map((t, i) => {
                  const pnl = Number(t.realized_pnl || 0);
                  const isLong = t.side.includes('long') || t.side === 'bid';
                  return (
                    <tr key={i} className="border-b border-border1 hover:bg-surface2">
                      <td className="px-3 py-2 text-[11px] text-text3 font-mono">{new Date(t.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <CoinLogo symbol={t.symbol} size={16} />
                          <span className="text-[12px] font-semibold">{t.symbol}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
                          {t.side.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] font-mono">${fmtPrice(Number(t.price))}</td>
                      <td className="px-3 py-2 text-[11px] font-mono">{fmt(Number(t.amount), 4)}</td>
                      <td className="px-3 py-2 text-[11px] font-mono text-warn">${fmt(Number(t.fee), 4)}</td>
                      <td className="px-3 py-2">
                        <span className={'text-[12px] font-bold font-mono ' + (pnl >= 0 ? 'text-success' : 'text-danger')}>
                          {pnl !== 0 ? (pnl >= 0 ? '+' : '') + '$' + fmt(pnl, 2) : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-text3 text-sm">No trade history found</div>
        )}
      </div>
    </div>
  );
}

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
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [newAlertSymbol, setNewAlertSymbol] = useState('BTC');
  const [newAlertPrice, setNewAlertPrice] = useState('');
  const [newAlertDir, setNewAlertDir] = useState<'above' | 'below'>('below');
  const [journalNotes, setJournalNotes] = useState('');
  const [journalResult, setJournalResult] = useState<'win' | 'loss' | 'open'>('open');
  const [journalPnl, setJournalPnl] = useState('');
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      const j = localStorage.getItem('pl_journal');
      if (j) setJournal(JSON.parse(j));
      const a = localStorage.getItem('pl_alerts');
      if (a) setAlerts(JSON.parse(a));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('pl_journal', JSON.stringify(journal)); } catch {}
  }, [journal]);

  useEffect(() => {
    try { localStorage.setItem('pl_alerts', JSON.stringify(alerts)); } catch {}
  }, [alerts]);

  useEffect(() => {
    if (!selected && markets.length > 0) setSelected(markets[0]);
  }, [markets, selected]);

  // Check price alerts
  useEffect(() => {
    if (!alerts.length) return;
    alerts.forEach(alert => {
      if (alert.triggered) return;
      const tk = tickers[alert.symbol];
      if (!tk) return;
      const price = getMarkPrice(tk);
      const hit = alert.direction === 'above' ? price >= alert.price : price <= alert.price;
      if (hit && !notifiedRef.current.has(alert.id)) {
        notifiedRef.current.add(alert.id);
        setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, triggered: true } : a));
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('PacificaLens Alert: ' + alert.symbol, {
            body: alert.symbol + ' hit $' + fmtPrice(alert.price) + '! Current: $' + fmtPrice(price),
          });
        }
      }
    });
  }, [tickers, alerts]);

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

  const closed = journal.filter(j => j.result !== 'open');
  const wins = closed.filter(j => j.result === 'win').length;
  const winRate = closed.length > 0 ? (wins / closed.length * 100) : 0;
  const totalPnl = closed.reduce((s, j) => s + (j.pnl || 0), 0);
  const avgRR = journal.length > 0
    ? journal.reduce((s, j) => {
        const reward = Math.abs(j.tp - j.entry);
        const risk = Math.abs(j.riskAmt);
        return s + (risk > 0 ? reward / risk : 0);
      }, 0) / journal.length
    : 0;

  function addJournalEntry() {
    if (!result || !selected) return;
    const entry: JournalEntry = {
      id: Date.now().toString(),
      ts: Date.now(),
      symbol: selected.symbol,
      side: result.side,
      entry: 0,
      tp: result.tp2,
      size: result.positionSize,
      riskAmt: result.riskAmount,
      notes: journalNotes,
      result: journalResult,
      pnl: journalPnl ? Number(journalPnl) : undefined,
    };
    setJournal(prev => [entry, ...prev]);
    setJournalNotes('');
    setJournalPnl('');
  }

  function addAlert() {
    if (!newAlertPrice) return;
    const alert: PriceAlert = {
      id: Date.now().toString(),
      symbol: newAlertSymbol,
      price: Number(newAlertPrice),
      direction: newAlertDir,
      triggered: false,
      ts: Date.now(),
    };
    setAlerts(prev => [alert, ...prev]);
    setNewAlertPrice('');
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }

  const activeAlerts = alerts.filter(a => !a.triggered).length;

  const rightTabs: { key: RiskTab; label: string }[] = [
    { key: 'results', label: 'Results' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'journal', label: 'Journal' },
    { key: 'alerts', label: activeAlerts > 0 ? ('Alerts (' + activeAlerts + ')') : 'Alerts' },
    { key: 'performance', label: 'Performance' },
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



          {/* Trade Journal */}
          {activeTab === 'journal' && (
            <div className="flex-1 overflow-auto p-4 bg-bg space-y-4">
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total Trades', value: String(journal.length), color: 'text-text1' },
                  { label: 'Win Rate', value: fmt(winRate, 1) + '%', color: winRate >= 50 ? 'text-success' : 'text-danger' },
                  { label: 'Total PnL', value: (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl, 2), color: totalPnl >= 0 ? 'text-success' : 'text-danger' },
                  { label: 'Avg R:R', value: fmt(avgRR, 2), color: avgRR >= 2 ? 'text-success' : 'text-warn' },
                ].map(s => (
                  <div key={s.label} className="bg-surface rounded-xl border border-border1 p-3 shadow-card">
                    <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
                    <div className={'text-[18px] font-bold ' + s.color}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
                <h3 className="text-[12px] font-semibold text-text2 mb-3">Log Trade</h3>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Notes</label>
                    <input className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent" placeholder="Notes..." value={journalNotes} onChange={e => setJournalNotes(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Result</label>
                    <select className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none" value={journalResult} onChange={e => setJournalResult(e.target.value as 'win' | 'loss' | 'open')}>
                      <option value="open">Open</option>
                      <option value="win">Win</option>
                      <option value="loss">Loss</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">PnL ($)</label>
                    <input type="number" className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent" placeholder="0.00" value={journalPnl} onChange={e => setJournalPnl(e.target.value)} />
                  </div>
                </div>
                <button onClick={addJournalEntry} disabled={!result} className="px-4 py-2 bg-accent text-white text-[12px] font-semibold rounded-lg hover:bg-accent2 transition-colors disabled:opacity-40">
                  Log from Calculator
                </button>
              </div>
              <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                {journal.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border1 bg-surface2">
                        {['Date', 'Symbol', 'Side', 'Size', 'Risk', 'Result', 'PnL', 'Notes'].map(h => (
                          <th key={h} className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {journal.map(j => (
                        <tr key={j.id} className="border-b border-border1 hover:bg-surface2">
                          <td className="px-3 py-2 text-[11px] text-text3">{new Date(j.ts).toLocaleDateString()}</td>
                          <td className="px-3 py-2"><div className="flex items-center gap-1.5"><CoinLogo symbol={j.symbol} size={16} /><span className="text-[12px] font-semibold">{j.symbol}</span></div></td>
                          <td className="px-3 py-2"><span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (j.side === 'long' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>{j.side.toUpperCase()}</span></td>
                          <td className="px-3 py-2 text-[11px] font-mono">{fmt(j.size, 4)}</td>
                          <td className="px-3 py-2 text-[11px] font-mono text-danger">${fmt(j.riskAmt, 2)}</td>
                          <td className="px-3 py-2"><span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (j.result === 'win' ? 'bg-success/10 text-success' : j.result === 'loss' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent')}>{j.result.toUpperCase()}</span></td>
                          <td className={'px-3 py-2 text-[11px] font-mono font-semibold ' + ((j.pnl || 0) >= 0 ? 'text-success' : 'text-danger')}>{j.pnl !== undefined ? ((j.pnl >= 0 ? '+' : '') + '$' + fmt(j.pnl, 2)) : '—'}</td>
                          <td className="px-3 py-2 text-[11px] text-text3 max-w-[100px] truncate">{j.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-10 text-center text-text3 text-sm">No journal entries. Use the Calculator and log your trades.</div>
                )}
              </div>
            </div>
          )}

          {/* Alerts */}
          {activeTab === 'alerts' && (
            <div className="flex-1 overflow-auto p-4 bg-bg space-y-4">
              <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
                <h3 className="text-[12px] font-semibold text-text2 mb-3">Create Price Alert</h3>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Symbol</label>
                    <select className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none" value={newAlertSymbol} onChange={e => setNewAlertSymbol(e.target.value)}>
                      {markets.map(m => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Direction</label>
                    <select className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none" value={newAlertDir} onChange={e => setNewAlertDir(e.target.value as 'above' | 'below')}>
                      <option value="above">Goes above</option>
                      <option value="below">Goes below</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Price ($)</label>
                    <input type="number" className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent" placeholder={'Current: $' + fmtPrice(getMarkPrice(tickers[newAlertSymbol]))} value={newAlertPrice} onChange={e => setNewAlertPrice(e.target.value)} />
                  </div>
                </div>
                <button onClick={addAlert} className="px-4 py-2 bg-accent text-white text-[12px] font-semibold rounded-lg hover:bg-accent2 transition-colors">
                  Set Alert
                </button>
              </div>
              <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border1 bg-surface2 flex justify-between items-center">
                  <span className="text-[12px] font-semibold text-text2">Active Alerts ({activeAlerts})</span>
                  {alerts.some(a => a.triggered) && (
                    <button onClick={() => setAlerts(prev => prev.filter(a => !a.triggered))} className="text-[11px] text-text3 hover:text-danger">Clear triggered</button>
                  )}
                </div>
                {alerts.length > 0 ? alerts.map(alert => {
                  const current = getMarkPrice(tickers[alert.symbol]);
                  const dist = current > 0 ? Math.abs((current - alert.price) / current * 100) : 0;
                  return (
                    <div key={alert.id} className={'flex items-center gap-4 px-4 py-3 border-b border-border1 hover:bg-surface2 ' + (alert.triggered ? 'opacity-50' : '')}>
                      <CoinLogo symbol={alert.symbol} size={22} />
                      <div className="flex-1">
                        <div className="text-[12px] font-semibold text-text1">{alert.symbol} {alert.direction === 'above' ? '≥' : '≤'} ${fmtPrice(alert.price)}</div>
                        <div className="text-[10px] text-text3">Now: ${fmtPrice(current)} · {fmt(dist, 1)}% away</div>
                      </div>
                      <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (alert.triggered ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent')}>
                        {alert.triggered ? 'TRIGGERED' : 'WATCHING'}
                      </span>
                      <button onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))} className="text-text3 hover:text-danger text-sm">✕</button>
                    </div>
                  );
                }) : (
                  <div className="p-10 text-center text-text3 text-sm">No alerts set.</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'performance' && wallet && (
            <PerformancePanel wallet={wallet} />
          )}
          {activeTab === 'performance' && !wallet && (
            <div className="flex-1 flex items-center justify-center text-text3">Connect wallet to view performance</div>
          )}

        </div>}
      />

      <AccountTabs positions={positions} tickers={tickers} wallet={wallet ?? null} />
    </div>
  );
}
