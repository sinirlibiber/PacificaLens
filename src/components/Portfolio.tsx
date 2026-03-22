'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getAccountInfo, getPositions, getEquityHistory, getTradesHistory,
  getOrderHistory, getFundingHistory,
  AccountInfo, Position, EquityHistory, TradeHistory, FundingHistory, OpenOrder, Ticker, Market,
} from '@/lib/pacifica';
import { fmt, fmtShortAddr, fmtPrice, getMarkPrice } from '@/lib/utils';
import { useOrderLog, OrderLogEntry, getCopyPerformance } from '@/hooks/useOrderLog';
import { PriceAlerts } from './PriceAlerts';
import { CoinLogo } from './CoinLogo';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(n: number, sign = false) {
  const s = sign && n > 0 ? '+' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return s + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e9, 2) + 'B';
  if (abs >= 1e6) return s + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e6, 2) + 'M';
  if (abs >= 1e3) return s + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e3, 1) + 'K';
  return s + (n < 0 ? '-$' : '$') + fmt(abs, 2);
}

function fmtTime(ts: string | number) {
  const d = new Date(typeof ts === 'string' ? ts : ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function sideLabel(side: string) {
  const s = side.toLowerCase();
  if (s.includes('open_long') || s === 'bid') return { label: 'Long', isLong: true };
  if (s.includes('open_short') || s === 'ask') return { label: 'Short', isLong: false };
  if (s.includes('close_long')) return { label: 'Close Long', isLong: true };
  if (s.includes('close_short')) return { label: 'Close Short', isLong: false };
  return { label: side, isLong: true };
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: EquityHistory[] }) {
  if (data.length < 2) return <div className="h-16 flex items-center justify-center text-[11px] text-text3">No history</div>;
  const vals = data.map(d => Number(d.equity));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 400, h = 60;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const isUp = vals[vals.length - 1] >= vals[0];
  const color = isUp ? 'var(--color-success)' : 'var(--color-danger)';
  const areaId = `area-${Math.random().toString(36).slice(2)}`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${areaId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-surface border border-border1 rounded-2xl px-5 py-4">
      <div className="text-[10px] text-text3 uppercase tracking-widest font-semibold mb-1">{label}</div>
      <div className={`text-[20px] font-bold tracking-tight ${accent ? 'text-accent' : 'text-text1'}`}>{value}</div>
      {sub && <div className="text-[11px] text-text3 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Order log row ────────────────────────────────────────────────────────────

function OrderLogRow({ entry }: { entry: OrderLogEntry }) {
  const isLong = entry.side === 'bid';
  const statusCfg = {
    pending:   { dot: 'bg-warn animate-pulse', text: 'text-warn',    label: 'Pending' },
    success:   { dot: 'bg-success',            text: 'text-success', label: 'Success' },
    failed:    { dot: 'bg-danger',             text: 'text-danger',  label: 'Failed' },
    cancelled: { dot: 'bg-text3',              text: 'text-text3',   label: 'Cancelled' },
  }[entry.status];

  return (
    <div className="grid grid-cols-7 gap-3 px-4 py-2.5 border-b border-border1 last:border-0 hover:bg-surface2/50 transition-colors text-[12px]">
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusCfg.dot}`} />
        <span className={`font-semibold text-[11px] ${statusCfg.text}`}>{statusCfg.label}</span>
      </div>
      <div className="font-bold text-text1">{entry.symbol}</div>
      <div className={`font-semibold ${isLong ? 'text-success' : 'text-danger'}`}>
        {entry.orderType === 'market' ? 'Market ' : 'Limit '}
        {isLong ? 'Long' : 'Short'}
      </div>
      <div className="font-mono text-text2">{entry.amount}</div>
      <div className="font-mono text-text2">${fmtPrice(Number(entry.price))}</div>
      <div className="text-text3">
        {entry.source === 'copy' ? '📋 Copy' : entry.source === 'auto-copy' ? '⚡ Auto' : '✋ Manual'}
        {entry.traderAddress && <span className="ml-1 text-text3 font-mono text-[10px]">{fmtShortAddr(entry.traderAddress)}</span>}
      </div>
      <div className="text-text3 text-[11px]">{fmtTime(entry.timestamp)}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type PortfolioTab = 'positions' | 'open_orders' | 'trade_history' | 'funding' | 'order_log' | 'copy_perf' | 'alerts';

interface PortfolioProps {
  wallet: string | null;
  tickers: Record<string, Ticker>;
  markets: Market[];
}

function SortTh({ label, sortKey, cur, dir, onClick, className }: {
  label: string; sortKey: string; cur: string; dir: 'asc' | 'desc'; onClick: () => void; className?: string;
}) {
  const active = cur === sortKey;
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors hover:text-accent ${active ? 'text-accent' : 'text-text3'} ${className || ''}`}>
      {label}
      <span className="text-[8px]">{active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}</span>
    </button>
  );
}

export function Portfolio({ wallet, tickers, markets }: PortfolioProps) {
  const [tab, setTab] = useState<PortfolioTab>('positions');
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: '', dir: 'desc' });

  function toggleSort(key: string) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }

  function sortData<T>(arr: T[], key: string, getter: (item: T) => number | string): T[] {
    if (!key) return arr;
    return [...arr].sort((a, b) => {
      const va = getter(a), vb = getter(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }

  const [accountInfo, setAccountInfo]   = useState<AccountInfo | null>(null);
  const [positions, setPositions]       = useState<Position[]>([]);
  const [equityHist, setEquityHist]     = useState<EquityHistory[]>([]);
  const [tradeHist, setTradeHist]       = useState<TradeHistory[]>([]);
  const [openOrders, setOpenOrders]     = useState<OpenOrder[]>([]);
  const [fundingHist, setFundingHist]   = useState<FundingHistory[]>([]);

  const { entries: orderLog, clearLog, stats: logStats } = useOrderLog(wallet);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const [acct, pos, eq, trades, orders, funding] = await Promise.all([
        getAccountInfo(wallet),
        getPositions(wallet),
        getEquityHistory(wallet),
        getTradesHistory(wallet, 100),
        getOrderHistory(wallet, 100),
        getFundingHistory(wallet),
      ]);
      setAccountInfo(acct);
      setPositions(pos);
      setEquityHist(eq);
      setTradeHist(trades);
      setOpenOrders(orders.filter((o: OpenOrder & { order_status?: string }) =>
        (o.order_status ?? o.status) === 'open'
      ));
      setFundingHist(funding);
      setLastRefresh(Date.now());
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!wallet) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg">
        <div className="text-center">
          <div className="text-[32px] mb-3">🔌</div>
          <div className="text-[14px] text-text3">Connect your wallet to view your portfolio</div>
        </div>
      </div>
    );
  }

  const equity = Number(accountInfo?.account_equity || 0);
  const balance = Number(accountInfo?.balance || 0);
  const marginUsed = Number(accountInfo?.total_margin_used || 0);
  const available = Number(accountInfo?.available_to_spend || 0);
  const unrealizedPnl = equity - balance;

  // Total realized PnL from trade history
  const realizedPnl = tradeHist.reduce((sum, t) => {
    const p = t as TradeHistory & { pnl?: string };
    return sum + Number(p.pnl ?? t.realized_pnl ?? 0);
  }, 0);

  const tabs: { key: PortfolioTab; label: string; count?: number }[] = [
    { key: 'positions',    label: 'Positions',     count: positions.length },
    { key: 'open_orders',  label: 'Open Orders',   count: openOrders.length },
    { key: 'trade_history',label: 'Trade History' },
    { key: 'funding',      label: 'Funding History' },
    { key: 'order_log',    label: 'PacificaLens Orders', count: logStats.pending > 0 ? logStats.pending : undefined },
    { key: 'copy_perf',    label: 'Copy Performance' },
    { key: 'alerts',       label: '🔔 Price Alerts' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1280px] mx-auto px-6 py-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-[20px] font-bold text-text1 tracking-tight">Portfolio</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="text-[11px] text-text3 font-mono">{wallet}</span>
              </div>
            </div>
            <button onClick={refresh} disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border1 rounded-lg text-[12px] text-text2 hover:border-accent/40 hover:text-accent transition-all disabled:opacity-50">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" className={loading ? 'animate-spin' : ''}>
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              {loading ? 'Refreshing...' : lastRefresh ? `Updated ${fmtTime(lastRefresh)}` : 'Refresh'}
            </button>
          </div>

          {/* Top stat cards */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <StatCard label="Account Equity" value={fmtUSD(equity)} accent />
            <StatCard label="Available Balance" value={fmtUSD(available)} />
            <StatCard label="Unrealized PnL" value={fmtUSD(unrealizedPnl, true)}
              sub={`Realized: ${fmtUSD(realizedPnl, true)}`} />
            <StatCard label="Margin Used" value={fmtUSD(marginUsed)}
              sub={`${equity > 0 ? ((marginUsed / equity) * 100).toFixed(1) : 0}% of equity`} />
          </div>

          {/* Equity chart + order log stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {/* Chart */}
            <div className="col-span-2 bg-surface border border-border1 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[12px] font-semibold text-text1">Equity History</span>
                {equityHist.length > 0 && (
                  <span className={`text-[12px] font-bold font-mono ${unrealizedPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                    {fmtUSD(unrealizedPnl, true)}
                  </span>
                )}
              </div>
              <Sparkline data={equityHist} />
              {equityHist.length > 1 && (
                <div className="flex justify-between mt-2">
                  <span className="text-[10px] text-text3">{fmtUSD(Number(equityHist[0]?.equity || 0))}</span>
                  <span className="text-[10px] text-text3">{fmtUSD(Number(equityHist[equityHist.length - 1]?.equity || 0))}</span>
                </div>
              )}
            </div>

            {/* PacificaLens order log stats */}
            <div className="bg-surface border border-border1 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[12px] font-semibold text-text1">PacificaLens Orders</span>
                <button onClick={() => setTab('order_log')}
                  className="text-[10px] text-accent hover:underline">View all</button>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Total Sent',  value: logStats.total,   color: 'text-text1' },
                  { label: 'Successful',  value: logStats.success, color: 'text-success' },
                  { label: 'Failed',      value: logStats.failed,  color: 'text-danger' },
                  { label: 'Pending',     value: logStats.pending, color: 'text-warn' },
                ].map(s => (
                  <div key={s.label} className="flex justify-between items-center">
                    <span className="text-[11px] text-text3">{s.label}</span>
                    <span className={`text-[15px] font-bold ${s.color}`}>{s.value}</span>
                  </div>
                ))}
              </div>
              {logStats.total > 0 && (
                <button onClick={clearLog}
                  className="mt-4 w-full py-1.5 text-[10px] text-text3 hover:text-danger border border-border1 hover:border-danger/30 rounded-lg transition-all">
                  Clear log
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-surface border border-border1 rounded-2xl overflow-hidden">
            <div className="flex border-b border-border1 px-4 pt-1 overflow-x-auto">
              {tabs.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-[12px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-all ${
                    tab === t.key ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2'
                  }`}>
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      tab === t.key ? 'bg-accent/15 text-accent' : 'bg-surface2 text-text3'
                    }`}>{t.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* POSITIONS */}
            {tab === 'positions' && (
              <div>
                {positions.length === 0 ? (
                  <div className="py-16 text-center text-[12px] text-text3">No open positions</div>
                ) : (
                  <>
                    <div className="grid grid-cols-7 gap-3 px-4 py-2 text-[10px] text-text3 uppercase tracking-wide font-semibold border-b border-border1 bg-surface2">
                      <span>Token</span><span>Size</span><span>Position Value</span>
                      <span>Entry / Breakeven</span><span>Mark Price</span><span>PnL (ROI%)</span><span>Liq Price</span>
                    </div>
                    {positions.map((pos, i) => {
                      const isLong = pos.side === 'bid';
                      const tk = tickers[pos.symbol];
                      const markPx = getMarkPrice(tk);
                      const entryPx = Number(pos.entry_price || 0);
                      const amt = Number(pos.amount || 0);
                      const rawPnl = Number((pos as Position & { unrealized_pnl?: string }).unrealized_pnl ?? 'x');
                      const pnl = isNaN(rawPnl)
                        ? (markPx > 0 && entryPx > 0 ? (isLong ? 1 : -1) * (markPx - entryPx) * amt : 0)
                        : rawPnl;
                      const posVal = (markPx || entryPx) * amt;
                      const pnlPct = posVal > 0 ? (pnl / posVal * 100) : 0;
                      return (
                        <div key={i} className="grid grid-cols-7 gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors items-center">
                          <div className="flex items-center gap-2">
                            <CoinLogo symbol={pos.symbol} size={20} />
                            <div>
                              <div className="text-[12px] font-bold text-text1">{pos.symbol}</div>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isLong ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
                                {isLong ? 'Long' : 'Short'}
                              </span>
                            </div>
                          </div>
                          <div className="font-mono text-[12px] text-text2">{fmt(amt, 4)} {pos.symbol}</div>
                          <div className="font-mono text-[12px] text-text2">{fmtUSD(posVal)}</div>
                          <div className="font-mono text-[12px] text-text2">${fmtPrice(entryPx)}</div>
                          <div className="font-mono text-[12px] text-text2">{markPx > 0 ? `$${fmtPrice(markPx)}` : '—'}</div>
                          <div>
                            <div className={`font-mono text-[12px] font-bold ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                              {fmtUSD(pnl, true)}
                            </div>
                            <div className={`text-[10px] ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                              ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                            </div>
                          </div>
                          <div className={`font-mono text-[12px] ${pos.liquidation_price ? 'text-danger' : 'text-text3'}`}>
                            {pos.liquidation_price ? `$${fmtPrice(Number(pos.liquidation_price))}` : 'N/A'}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* OPEN ORDERS */}
            {tab === 'open_orders' && (
              <div>
                {openOrders.length === 0 ? (
                  <div className="py-16 text-center text-[12px] text-text3">No open orders</div>
                ) : (
                  <>
                    <div className="grid grid-cols-5 gap-3 px-4 py-2 border-b border-border1 bg-surface2">
                      <SortTh label="Symbol" sortKey="oo_symbol" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_symbol')} />
                      <SortTh label="Side" sortKey="oo_side" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_side')} />
                      <span className="text-[10px] text-text3 uppercase tracking-wide font-semibold">Type</span>
                      <SortTh label="Price" sortKey="oo_price" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_price')} />
                      <SortTh label="Amount" sortKey="oo_amount" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_amount')} />
                    </div>
                    {sortData(openOrders, sort.key.startsWith('oo_') ? sort.key.replace('oo_', '') : '', (o) => {
                      const p = (o as OpenOrder & { initial_price?: string }).initial_price ?? o.price ?? '0';
                      if (sort.key === 'oo_symbol') return o.symbol;
                      if (sort.key === 'oo_side') return o.side;
                      if (sort.key === 'oo_price') return Number(p);
                      if (sort.key === 'oo_amount') return Number(o.amount);
                      return 0;
                    }).map((o, i) => {
                      const { label, isLong } = sideLabel(o.side);
                      const price = (o as OpenOrder & { initial_price?: string }).initial_price ?? o.price ?? '0';
                      return (
                        <div key={i} className="grid grid-cols-5 gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors text-[12px]">
                          <div className="font-bold text-text1">{o.symbol}</div>
                          <div className={`font-semibold ${isLong ? 'text-success' : 'text-danger'}`}>{label}</div>
                          <div className="text-text3 uppercase text-[11px]">{o.order_type ?? 'limit'}</div>
                          <div className="font-mono text-text2">${fmtPrice(Number(price))}</div>
                          <div className="font-mono text-text2">{Number(o.amount).toFixed(4)}</div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* TRADE HISTORY */}
            {tab === 'trade_history' && (
              <div>
                {tradeHist.length === 0 ? (
                  <div className="py-16 text-center text-[12px] text-text3">No trade history</div>
                ) : (
                  <>
                    <div className="grid grid-cols-6 gap-3 px-4 py-2 border-b border-border1 bg-surface2">
                      <SortTh label="Symbol" sortKey="th_symbol" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('th_symbol')} />
                      <SortTh label="Side" sortKey="th_side" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('th_side')} />
                      <SortTh label="Price" sortKey="th_price" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('th_price')} />
                      <SortTh label="Size" sortKey="th_amount" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('th_amount')} />
                      <SortTh label="Realized PnL" sortKey="th_pnl" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('th_pnl')} />
                      <SortTh label="Time" sortKey="th_time" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('th_time')} />
                    </div>
                    {sortData(tradeHist, sort.key.startsWith('th_') ? sort.key : '', (t) => {
                      const pnlVal = Number((t as TradeHistory & { pnl?: string }).pnl ?? t.realized_pnl ?? 0);
                      if (sort.key === 'th_symbol') return t.symbol;
                      if (sort.key === 'th_side') return t.side;
                      if (sort.key === 'th_price') return Number(t.price);
                      if (sort.key === 'th_amount') return Number(t.amount);
                      if (sort.key === 'th_pnl') return pnlVal;
                      if (sort.key === 'th_time') return typeof t.created_at === 'number' ? t.created_at : new Date(t.created_at).getTime();
                      return 0;
                    }).map((t, i) => {
                      const { label, isLong } = sideLabel(t.side);
                      const pnl = Number((t as TradeHistory & { pnl?: string }).pnl ?? t.realized_pnl ?? 0);
                      return (
                        <div key={i} className="grid grid-cols-6 gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors text-[12px]">
                          <div className="font-bold text-text1">{t.symbol}</div>
                          <div className={`font-semibold ${isLong ? 'text-success' : 'text-danger'}`}>{label}</div>
                          <div className="font-mono text-text2">${fmtPrice(Number(t.price))}</div>
                          <div className="font-mono text-text2">{Number(t.amount).toFixed(4)}</div>
                          <div className={`font-mono font-semibold ${pnl > 0 ? 'text-success' : pnl < 0 ? 'text-danger' : 'text-text3'}`}>
                            {pnl !== 0 ? fmtUSD(pnl, true) : '—'}
                          </div>
                          <div className="text-text3 text-[11px]">{fmtTime(t.created_at)}</div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* FUNDING HISTORY */}
            {tab === 'funding' && (
              <div>
                {fundingHist.length === 0 ? (
                  <div className="py-16 text-center text-[12px] text-text3">No funding history</div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-3 px-4 py-2 text-[10px] text-text3 uppercase tracking-wide font-semibold border-b border-border1 bg-surface2">
                      <span>Symbol</span><span>Rate</span><span>Amount</span><span>Time</span>
                    </div>
                    {fundingHist.map((f, i) => {
                      const amt = Number(f.amount || 0);
                      return (
                        <div key={i} className="grid grid-cols-4 gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors text-[12px]">
                          <div className="font-bold text-text1">{f.symbol}</div>
                          <div className={`font-mono ${Number(f.rate) >= 0 ? 'text-success' : 'text-danger'}`}>
                            {(Number(f.rate) * 100).toFixed(4)}%
                          </div>
                          <div className={`font-mono font-semibold ${amt >= 0 ? 'text-success' : 'text-danger'}`}>
                            {amt >= 0 ? '+' : ''}${Math.abs(amt).toFixed(4)}
                          </div>
                          <div className="text-text3 text-[11px]">{fmtTime(f.timestamp)}</div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* PACIFICALENS ORDER LOG */}
            {tab === 'order_log' && (
              <div>
                <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {[
                      { label: 'All', count: logStats.total, status: undefined },
                      { label: 'Success', count: logStats.success, color: 'text-success' },
                      { label: 'Failed', count: logStats.failed, color: 'text-danger' },
                      { label: 'Pending', count: logStats.pending, color: 'text-warn' },
                    ].map(s => (
                      <div key={s.label} className="flex items-center gap-1">
                        <span className={`text-[11px] font-semibold ${s.color || 'text-text2'}`}>{s.label}</span>
                        <span className="text-[11px] text-text3">({s.count})</span>
                      </div>
                    ))}
                  </div>
                  {orderLog.length > 0 && (
                    <button onClick={clearLog}
                      className="text-[11px] text-text3 hover:text-danger transition-colors">
                      Clear all
                    </button>
                  )}
                </div>
                {orderLog.length === 0 ? (
                  <div className="py-16 text-center">
                    <div className="text-[13px] text-text3 mb-1">No orders sent yet</div>
                    <div className="text-[11px] text-text3">Orders sent via PacificaLens will appear here</div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-7 gap-3 px-4 py-2 text-[10px] text-text3 uppercase tracking-wide font-semibold border-b border-border1 bg-surface2">
                      <span>Status</span><span>Symbol</span><span>Side</span><span>Amount</span><span>Price</span><span>Source</span><span>Time</span>
                    </div>
                    {orderLog.map(entry => <OrderLogRow key={entry.id} entry={entry} />)}
                  </>
                )}
              </div>
            )}

            {/* ALERTS */}
            {tab === 'alerts' && (
              <div className="p-0">
                <PriceAlerts markets={markets} tickers={tickers} embedded />
              </div>
            )}

            {/* COPY PERFORMANCE */}
            {tab === 'copy_perf' && (() => {
              const perf = getCopyPerformance(orderLog);
              if (!perf.length) return (
                <div className="py-16 text-center">
                  <div className="text-[13px] text-text3 mb-1">No copy trade data yet</div>
                  <div className="text-[11px] text-text3">Copy trades from the Copy tab to see performance here</div>
                </div>
              );
              return (
                <div>
                  <div className="grid grid-cols-5 gap-3 px-4 py-2 text-[10px] text-text3 uppercase tracking-wide font-semibold border-b border-border1 bg-surface2">
                    <span>Trader</span><span className="text-right">Orders</span><span className="text-right">Success Rate</span><span className="text-right">Total PnL</span><span className="text-right">Best / Worst</span>
                  </div>
                  {perf.map((p, i) => (
                    <div key={i} className="grid grid-cols-5 gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors items-center text-[12px]">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
                          {p.traderAddress.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-mono text-text2">{p.traderAddress.slice(0, 8)}...{p.traderAddress.slice(-4)}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-text1">{p.successOrders}</span>
                        <span className="text-text3">/{p.totalOrders}</span>
                      </div>
                      <div className={`text-right font-bold ${p.winRate >= 50 ? 'text-success' : 'text-danger'}`}>
                        {p.winRate.toFixed(0)}%
                      </div>
                      <div className={`text-right font-mono font-bold ${p.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        {p.totalPnl !== 0 ? `${p.totalPnl >= 0 ? '+' : ''}$${Math.abs(p.totalPnl).toFixed(2)}` : '—'}
                      </div>
                      <div className="text-right text-[11px]">
                        {p.bestTrade !== 0 && <span className="text-success">+${p.bestTrade.toFixed(2)}</span>}
                        {p.bestTrade !== 0 && p.worstTrade !== 0 && <span className="text-text3"> / </span>}
                        {p.worstTrade !== 0 && <span className="text-danger">${p.worstTrade.toFixed(2)}</span>}
                        {p.bestTrade === 0 && p.worstTrade === 0 && <span className="text-text3">—</span>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

          </div>
        </div>
      </div>
    </div>
  );
}
