'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getAccountInfo, getPositions, getEquityHistory, getTradesHistory,
  getOrderHistory, getFundingHistory, getTradeHistory,
  AccountInfo, Position, EquityHistory, TradeHistory, FundingHistory, OpenOrder, Ticker, Market,
} from '@/lib/pacifica';
import { fmt, fmtShortAddr, fmtPrice, getMarkPrice } from '@/lib/utils';
import { useOrderLog, OrderLogEntry, getCopyPerformance } from '@/hooks/useOrderLog';
import { PriceAlerts } from './PriceAlerts';
import { CoinLogo } from './CoinLogo';
import { useShell } from './AppShell';
import { cancelOrder, closePosition } from '@/lib/pacificaSigning';
import { getOpenOrders } from '@/lib/pacifica';

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
  if (data.length < 2) return (
    <div className="h-16 flex flex-col items-center justify-center gap-1">
      <div className="text-[11px] text-text3">No equity history available</div>
      <div className="text-[10px] text-text3/60">Endpoint may not be supported on this account</div>
    </div>
  );
  const vals = data.map(d => Number(d.equity));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 400, h = 60;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const isUp = vals[vals.length - 1] >= vals[0];
  const color = isUp ? 'var(--success)' : 'var(--danger)';
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

type PortfolioTab = 'positions' | 'open_orders' | 'trade_history' | 'funding' | 'order_log' | 'copy_perf' | 'alerts' | 'heatmap' | 'journal' | 'performance';

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
  const { walletSignFn, ensureBuilderApproved, setToast } = useShell() as any;
  const [tab, setTab] = useState<PortfolioTab>('positions');
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // track which row is loading

  // Journal state
  const JOURNAL_KEY = `pacificalens_journal_${wallet || 'anon'}`;
  interface JournalEntry { id: string; ts: number; symbol: string; side: 'long' | 'short'; notes: string; result: 'win' | 'loss' | 'open'; pnl?: number; }
  const [journal, setJournal] = useState<JournalEntry[]>(() => {
    try { const r = localStorage.getItem(JOURNAL_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [jSymbol, setJSymbol] = useState('BTC');
  const [jSide, setJSide] = useState<'long'|'short'>('long');
  const [jNotes, setJNotes] = useState('');
  const [jResult, setJResult] = useState<'win'|'loss'|'open'>('open');
  const [jPnl, setJPnl] = useState('');

  function addJournalEntry() {
    if (!jNotes.trim()) return;
    const entry: JournalEntry = { id: crypto.randomUUID(), ts: Date.now(), symbol: jSymbol, side: jSide, notes: jNotes, result: jResult, pnl: jPnl ? Number(jPnl) : undefined };
    const next = [entry, ...journal];
    setJournal(next);
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(next)); } catch {}
    setJNotes(''); setJPnl('');
  }
  function deleteJournalEntry(id: string) {
    const next = journal.filter(e => e.id !== id);
    setJournal(next);
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(next)); } catch {}
  }
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

  // ── Close Position ───────────────────────────────────────────────────────────
  async function handleClosePosition(pos: Position) {
    if (!wallet) return;
    const key = `close-${pos.symbol}`;
    setActionLoading(key);
    try {
      const approved = await ensureBuilderApproved();
      if (!approved) { setActionLoading(null); return; }
      const amt = Number(pos.amount || 0);
      const lotDecimals = markets.find(m => m.symbol === pos.symbol)?.lot_size
        ? Math.ceil(-Math.log10(Number(markets.find(m => m.symbol === pos.symbol)?.lot_size)))
        : 4;
      const result = await closePosition(
        wallet,
        pos.symbol,
        amt.toFixed(lotDecimals),
        pos.side as 'bid' | 'ask',
        walletSignFn
      );
      if (result.success) {
        setToast?.({ message: `✓ ${pos.symbol} position closed`, type: 'success' });
        setTimeout(() => refresh(), 2000);
      } else {
        setToast?.({ message: `Close failed: ${result.error}`, type: 'error' });
      }
    } catch (e) {
      setToast?.({ message: `Error: ${String(e)}`, type: 'error' });
    } finally {
      setActionLoading(null);
    }
  }

  // ── Cancel Order ──────────────────────────────────────────────────────────────
  async function handleCancelOrder(order: OpenOrder) {
    if (!wallet) return;
    const orderId = (order as any).order_id ?? (order as any).id;
    if (!orderId) { setToast?.({ message: 'No order ID found', type: 'error' }); return; }
    const key = `cancel-${orderId}`;
    setActionLoading(key);
    try {
      const approved = await ensureBuilderApproved();
      if (!approved) { setActionLoading(null); return; }
      const result = await cancelOrder(wallet, orderId, walletSignFn);
      if (result.success) {
        setToast?.({ message: `✓ Order cancelled`, type: 'success' });
        setTimeout(() => refresh(), 2000);
      } else {
        setToast?.({ message: `Cancel failed: ${result.error}`, type: 'error' });
      }
    } catch (e) {
      setToast?.({ message: `Error: ${String(e)}`, type: 'error' });
    } finally {
      setActionLoading(null);
    }
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
    { key: 'heatmap',      label: 'Heat Map' },
    { key: 'journal',      label: 'Journal', count: journal.filter(e => e.result === 'open').length || undefined },
    { key: 'performance',  label: 'Performance' },
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
                    <div className="grid gap-3 px-4 py-2 text-[10px] text-text3 uppercase tracking-wide font-semibold border-b border-border1 bg-surface2" style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1fr 1fr auto' }}>
                      <span>Token</span><span>Size</span><span>Position Value</span>
                      <span>Entry Price</span><span>Mark Price</span><span>PnL (ROI%)</span><span>Liq Price</span><span>Action</span>
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
                        <div key={i} className="grid gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors items-center" style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1fr 1fr auto' }}>
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
                          <div>
                            <button
                              onClick={() => handleClosePosition(pos)}
                              disabled={actionLoading === `close-${pos.symbol}`}
                              className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all disabled:opacity-50"
                              style={{
                                background: 'rgba(255,61,61,0.12)',
                                color: '#ff3d3d',
                                border: '1px solid rgba(255,61,61,0.25)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {actionLoading === `close-${pos.symbol}` ? '...' : 'Close'}
                            </button>
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
                    <div className="grid gap-3 px-4 py-2 border-b border-border1 bg-surface2" style={{ gridTemplateColumns: '1fr 1fr 80px 1fr 1fr auto' }}>
                      <SortTh label="Symbol" sortKey="oo_symbol" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_symbol')} />
                      <SortTh label="Side" sortKey="oo_side" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_side')} />
                      <span className="text-[10px] text-text3 uppercase tracking-wide font-semibold">Type</span>
                      <SortTh label="Price" sortKey="oo_price" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_price')} />
                      <SortTh label="Amount" sortKey="oo_amount" cur={sort.key} dir={sort.dir} onClick={() => toggleSort('oo_amount')} />
                      <span className="text-[10px] text-text3 uppercase tracking-wide font-semibold">Action</span>
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
                        <div key={i} className="grid gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors text-[12px] items-center" style={{ gridTemplateColumns: '1fr 1fr 80px 1fr 1fr auto' }}>
                          <div className="font-bold text-text1">{o.symbol}</div>
                          <div className={`font-semibold ${isLong ? 'text-success' : 'text-danger'}`}>{label}</div>
                          <div className="text-text3 uppercase text-[11px]">{o.order_type ?? 'limit'}</div>
                          <div className="font-mono text-text2">${fmtPrice(Number(price))}</div>
                          <div className="font-mono text-text2">{Number(o.amount).toFixed(4)}</div>
                          <div>
                            <button
                              onClick={() => handleCancelOrder(o)}
                              disabled={actionLoading === `cancel-${(o as any).order_id ?? (o as any).id}`}
                              className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all disabled:opacity-50"
                              style={{
                                background: 'rgba(255,171,0,0.1)',
                                color: '#ffc107',
                                border: '1px solid rgba(255,171,0,0.25)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {actionLoading === `cancel-${(o as any).order_id ?? (o as any).id}` ? '...' : 'Cancel'}
                            </button>
                          </div>
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
              const totalOrders = perf.reduce((s, p) => s + p.totalOrders, 0);
              const totalSuccess = perf.reduce((s, p) => s + p.successOrders, 0);
              if (!perf.length) return (
                <div className="py-16 text-center space-y-2">
                  <div className="text-3xl mb-3">📋</div>
                  <div className="text-[14px] font-semibold text-text1">No copy trades yet</div>
                  <div className="text-[12px] text-text3">Go to the Copy tab, find a trader and copy their positions</div>
                </div>
              );
              return (
                <div>
                  {/* Summary row */}
                  <div className="grid grid-cols-3 gap-3 p-4 border-b border-border1">
                    {[
                      { label: 'Traders Copied', value: String(perf.length), color: 'text-accent' },
                      { label: 'Total Orders', value: String(totalOrders), color: 'text-text1' },
                      { label: 'Success Rate', value: totalOrders > 0 ? `${(totalSuccess / totalOrders * 100).toFixed(0)}%` : '—', color: totalOrders > 0 && totalSuccess / totalOrders >= 0.5 ? 'text-success' : 'text-danger' },
                    ].map(s => (
                      <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-4 py-3">
                        <div className="text-[10px] text-text3 uppercase font-semibold mb-1">{s.label}</div>
                        <div className={`text-[20px] font-bold ${s.color}`}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Per-trader table */}
                  <div className="grid grid-cols-4 gap-3 px-4 py-2 text-[10px] text-text3 uppercase tracking-wide font-semibold border-b border-border1 bg-surface2">
                    <span>Trader</span><span className="text-right">Orders</span><span className="text-right">Success Rate</span><span className="text-right">Status</span>
                  </div>
                  {perf.map((p, i) => (
                    <div key={i} className="grid grid-cols-4 gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors items-center text-[12px]">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
                          {p.traderAddress.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-mono text-[11px] text-text2">{p.traderAddress.slice(0, 8)}...{p.traderAddress.slice(-4)}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-text1">{p.successOrders}</span>
                        <span className="text-text3 text-[11px]">/{p.totalOrders}</span>
                      </div>
                      <div className={`text-right font-bold ${p.winRate >= 50 ? 'text-success' : 'text-danger'}`}>
                        {p.winRate.toFixed(0)}%
                      </div>
                      <div className="text-right">
                        {p.totalOrders > 0 && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.winRate >= 50 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                            {p.winRate >= 50 ? 'Good' : 'Poor'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="px-4 py-3 text-[10px] text-text3 border-t border-border1">
                    ℹ️ <span className="font-semibold">Order placement success rate only.</span> PnL is not tracked here — check your Portfolio → Trade History for realized PnL on copied trades. Orders are logged locally in your browser.
                  </div>
                </div>
              );
            })()}


            {/* HEAT MAP */}
            {tab === 'heatmap' && (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Portfolio Risk', value: `${equity > 0 ? ((marginUsed / equity) * 100).toFixed(1) : 0}%`,
                      color: (marginUsed / Math.max(equity, 1)) * 100 < 10 ? 'text-success' : (marginUsed / Math.max(equity, 1)) * 100 < 25 ? 'text-warn' : 'text-danger' },
                    { label: 'Margin Used', value: fmtUSD(marginUsed), color: 'text-text1' },
                    { label: 'Open Positions', value: String(positions.length), color: positions.length > 0 ? 'text-accent' : 'text-text3' },
                  ].map(s => (
                    <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-4 py-3">
                      <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
                      <div className={`text-[20px] font-bold ${s.color}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {/* Risk bar */}
                <div className="bg-surface border border-border1 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[12px] font-semibold text-text1">Risk Exposure</span>
                    <span className={`text-[15px] font-bold ${(marginUsed / Math.max(equity, 1)) * 100 < 10 ? 'text-success' : (marginUsed / Math.max(equity, 1)) * 100 < 25 ? 'text-warn' : 'text-danger'}`}>
                      {equity > 0 ? ((marginUsed / equity) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                  <div className="relative h-4 bg-gradient-to-r from-success via-warn to-danger rounded-full">
                    <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-2 border-text2 rounded-full shadow transition-all"
                      style={{ left: `calc(${Math.min((marginUsed / Math.max(equity, 1)) * 200, 96)}% - 10px)` }} />
                  </div>
                  <div className="flex justify-between text-[10px] mt-1.5">
                    <span className="text-success font-semibold">Safe &lt;10%</span>
                    <span className="text-warn font-semibold">Moderate 10-25%</span>
                    <span className="text-danger font-semibold">High &gt;25%</span>
                  </div>
                </div>
                {/* Bubble map */}
                {positions.length > 0 ? (
                  <div className="bg-surface border border-border1 rounded-xl p-4">
                    <div className="text-[12px] font-semibold text-text1 mb-4">Position Bubbles</div>
                    <div className="flex flex-wrap gap-4 justify-center">
                      {positions.map((p, i) => {
                        const tk = tickers[p.symbol];
                        const size = Number(p.amount || 0) * (getMarkPrice(tk) || Number(p.entry_price));
                        const maxSize = Math.max(...positions.map(pos => Number(pos.amount || 0) * (getMarkPrice(tickers[pos.symbol]) || Number(pos.entry_price))));
                        const rel = maxSize > 0 ? size / maxSize : 0;
                        const isLong = p.side === 'bid';
                        const d = Math.max(60, rel * 120);
                        return (
                          <div key={i} className="flex flex-col items-center gap-1">
                            <div className="rounded-full flex flex-col items-center justify-center border-2 transition-all"
                              style={{ width: d, height: d, background: isLong ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', borderColor: isLong ? '#10b981' : '#ef4444' }}>
                              <CoinLogo symbol={p.symbol} size={Math.max(16, d * 0.3)} />
                              <span className="text-[9px] font-bold text-text1 mt-0.5">{p.symbol}</span>
                            </div>
                            <span className={`text-[10px] font-bold ${isLong ? 'text-success' : 'text-danger'}`}>{isLong ? '↑ LONG' : '↓ SHORT'}</span>
                            <span className="text-[10px] text-text3 font-mono">{fmtUSD(size)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-[12px] text-text3">No open positions</div>
                )}
              </div>
            )}

            {/* JOURNAL */}
            {tab === 'journal' && (
              <div className="p-4 space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Entries', value: String(journal.length), color: 'text-text1' },
                    { label: 'Win Rate', value: journal.filter(e => e.result !== 'open').length > 0 ? `${(journal.filter(e => e.result === 'win').length / journal.filter(e => e.result !== 'open').length * 100).toFixed(0)}%` : '—', color: 'text-success' },
                    { label: 'Total PnL', value: fmtUSD(journal.reduce((s, e) => s + (e.pnl || 0), 0), true), color: journal.reduce((s, e) => s + (e.pnl || 0), 0) >= 0 ? 'text-success' : 'text-danger' },
                  ].map(s => (
                    <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-4 py-3">
                      <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
                      <div className={`text-[18px] font-bold ${s.color}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {/* Add entry */}
                <div className="bg-surface border border-border1 rounded-xl p-4">
                  <div className="text-[12px] font-semibold text-text1 mb-3">Log Trade</div>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Symbol</label>
                      <select value={jSymbol} onChange={e => setJSymbol(e.target.value)}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-accent">
                        {markets.map(m => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Side</label>
                      <select value={jSide} onChange={e => setJSide(e.target.value as 'long'|'short')}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-accent">
                        <option value="long">Long</option>
                        <option value="short">Short</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Result</label>
                      <select value={jResult} onChange={e => setJResult(e.target.value as 'win'|'loss'|'open')}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-accent">
                        <option value="open">Open</option>
                        <option value="win">Win</option>
                        <option value="loss">Loss</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">PnL ($)</label>
                      <input type="number" value={jPnl} onChange={e => setJPnl(e.target.value)} placeholder="0.00"
                        className="w-full bg-surface2 border border-border1 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-accent" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input value={jNotes} onChange={e => setJNotes(e.target.value)} placeholder="Trade notes..."
                      className="flex-1 bg-surface2 border border-border1 rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-accent"
                      onKeyDown={e => e.key === 'Enter' && addJournalEntry()} />
                    <button onClick={addJournalEntry} disabled={!jNotes.trim()}
                      className="px-4 py-1.5 bg-accent text-white text-[12px] font-semibold rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40">
                      + Log
                    </button>
                  </div>
                </div>
                {/* Entries */}
                <div className="bg-surface border border-border1 rounded-xl overflow-hidden">
                  {journal.length === 0 ? (
                    <div className="py-12 text-center text-[12px] text-text3">No entries yet. Log your first trade above.</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-6 gap-2 px-4 py-2 text-[10px] text-text3 uppercase font-semibold border-b border-border1 bg-surface2">
                        <span>Date</span><span>Symbol</span><span>Side</span><span>Result</span><span>PnL</span><span>Notes</span>
                      </div>
                      {journal.map(e => (
                        <div key={e.id} className="grid grid-cols-6 gap-2 px-4 py-2.5 border-b border-border1 last:border-0 hover:bg-surface2/40 transition-colors text-[12px] items-center group">
                          <span className="text-text3 text-[11px]">{new Date(e.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
                          <span className="font-bold text-text1">{e.symbol}</span>
                          <span className={`font-semibold ${e.side === 'long' ? 'text-success' : 'text-danger'}`}>{e.side === 'long' ? 'Long' : 'Short'}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-block whitespace-nowrap w-fit ${e.result === 'win' ? 'bg-success/10 text-success' : e.result === 'loss' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>
                            {e.result.toUpperCase()}
                          </span>
                          <span className={`font-mono font-semibold ${(e.pnl || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                            {e.pnl !== undefined ? fmtUSD(e.pnl, true) : '—'}
                          </span>
                          <div className="flex items-center justify-between">
                            <span className="text-text3 truncate text-[11px]">{e.notes}</span>
                            <button onClick={() => deleteJournalEntry(e.id)}
                              className="text-danger/50 hover:text-danger transition-colors text-[13px] ml-2 font-bold shrink-0">✕</button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* PERFORMANCE */}
            {tab === 'performance' && (
              <div className="p-4 space-y-4">
                {!wallet ? (
                  <div className="py-16 text-center text-[12px] text-text3">Connect wallet to view performance</div>
                ) : (() => {
                  const totalPnl = tradeHist.reduce((s, t) => s + Number((t as TradeHistory & {pnl?:string}).pnl ?? t.realized_pnl ?? 0), 0);
                  const totalFunding = fundingHist.reduce((s, f) => s + Number(f.amount || 0), 0);
                  const wins = tradeHist.filter(t => Number((t as TradeHistory & {pnl?:string}).pnl ?? t.realized_pnl ?? 0) > 0).length;
                  const winRate = tradeHist.length > 0 ? (wins / tradeHist.length * 100) : 0;
                  const fees = tradeHist.reduce((s, t) => s + Number((t as TradeHistory & {fee?:string}).fee ?? 0), 0);
                  return (
                    <>
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'Realized PnL', value: fmtUSD(totalPnl, true), color: totalPnl >= 0 ? 'text-success' : 'text-danger' },
                          { label: 'Funding Earned', value: fmtUSD(totalFunding, true), color: totalFunding >= 0 ? 'text-success' : 'text-danger' },
                          { label: 'Fees Paid', value: fmtUSD(fees), color: 'text-warn' },
                          { label: 'Win Rate', value: winRate.toFixed(1) + '%', color: winRate >= 50 ? 'text-success' : 'text-danger' },
                        ].map(s => (
                          <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-4 py-3">
                            <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
                            <div className={`text-[18px] font-bold ${s.color}`}>{s.value}</div>
                            <div className="text-[9px] text-text3 mt-0.5">{tradeHist.length} trades</div>
                          </div>
                        ))}
                      </div>
                      {equityHist.length > 1 && (
                        <div className="bg-surface border border-border1 rounded-xl p-4">
                          <div className="text-[12px] font-semibold text-text1 mb-3">Equity History</div>
                          <div className="h-40 flex items-end gap-px">
                            {equityHist.slice(-60).map((e, i) => {
                              const vals = equityHist.slice(-60).map(x => Number(x.equity));
                              const min = Math.min(...vals); const max = Math.max(...vals);
                              const pct = max > min ? ((Number(e.equity) - min) / (max - min)) * 100 : 50;
                              const isUp = i > 0 ? Number(e.equity) >= Number(equityHist.slice(-60)[i-1]?.equity) : true;
                              return <div key={i} className={`flex-1 rounded-t-sm transition-all ${isUp ? 'bg-success/40' : 'bg-danger/40'}`} style={{ height: `${Math.max(2, pct)}%` }} />;
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
