'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useCopyTrading,
  SortField,
  LeaderboardEntry,
  FavoriteTrader,
  TraderTrade,
} from '@/hooks/useCopyTrading';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtShortAddr, fmtPrice, getMarkPrice } from '@/lib/utils';
import { Market, Ticker, AccountInfo, getAccountInfo, getPositions, getEquityHistory, getTradeHistory, getPortfolioStats, getTradesHistory, getOpenOrders, getOrderHistory, getFundingHistory, PortfolioStats } from '@/lib/pacifica';
import { CalcResult } from './Calculator';
import { submitMarketOrder, submitLimitOrder, toBase58 } from '@/lib/pacificaSigning';
import { useOrderLog } from '@/hooks/useOrderLog';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AutoPosConfig {
  amount: number;
  slEnabled: boolean;
  slPct: number;
  tpEnabled: boolean;
  tpPct: number;
  maxPositions: number;
  cooldownMinutes: number;
  active: boolean;
}

const DEFAULT_AUTO_CONFIG: AutoPosConfig = {
  amount: 100,
  slEnabled: false, slPct: 5,
  tpEnabled: false, tpPct: 10,
  maxPositions: 0, cooldownMinutes: 0,
  active: false,
};


// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtN(n: number, showSign = false): string {
  const sign = showSign ? (n >= 0 ? '+' : '') : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return sign + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e9, 2) + 'B';
  if (abs >= 1e6) return sign + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e6, 2) + 'M';
  if (abs >= 1e3) return sign + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e3, 1) + 'K';
  return sign + (n < 0 ? '-$' : '$') + fmt(abs, 0);
}

function fmtTime(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function sideLabel(side: string): { label: string; isLong: boolean } {
  const s = side.toLowerCase();
  if (s.includes('long') || s === 'bid') return { label: s.includes('close') ? 'Close Long' : 'Long', isLong: true };
  if (s.includes('short') || s === 'ask') return { label: s.includes('close') ? 'Close Short' : 'Short', isLong: false };
  return { label: side, isLong: true };
}

// ─── Sort column header ───────────────────────────────────────────────────────

function Th({ label, field, cur, dir, onClick }: {
  label: string;
  field: SortField;
  cur: SortField;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  const active = cur === field;
  return (
    <th
      onClick={onClick}
      className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-right cursor-pointer hover:text-accent select-none whitespace-nowrap transition-colors"
    >
      {label}
      <span className={'ml-1 ' + (active ? 'text-accent' : 'text-border2')}>
        {active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}
      </span>
    </th>
  );
}

// ─── Favorite Card (expanded) ─────────────────────────────────────────────────

function FavoriteCard({
  fav, lbEntry, trades, tradesLoading, tickers,
  onRemove, onCopyTrade, onRefreshTrades,
}: {
  fav: FavoriteTrader;
  lbEntry?: LeaderboardEntry;
  trades: TraderTrade[];
  tradesLoading: boolean;
  tickers: Record<string, Ticker>;
  onRemove: () => void;
  onCopyTrade: (trade: TraderTrade) => void;
  onRefreshTrades: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border1 rounded-2xl bg-surface overflow-hidden shadow-card">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-surface2/50 transition-colors"
        onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
              {fav.account.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-[12px] font-mono text-text1 font-semibold">{fmtShortAddr(fav.account)}</span>

          </div>
          {lbEntry && (
            <div className="flex items-center gap-3 mt-1">
              <span className={`text-[10px] font-semibold ${lbEntry.pnl_30d >= 0 ? 'text-success' : 'text-danger'}`}>
                PnL 30d: {fmtN(lbEntry.pnl_30d, true)}
              </span>
              <span className="text-[10px] text-text3">Vol: {fmtN(lbEntry.volume_30d)}</span>
            </div>
          )}
        </div>

        <button onClick={e => { e.stopPropagation(); onRemove(); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text3 hover:text-danger hover:bg-danger/5 transition-all text-[14px]">×</button>
        <span className={`text-text3 text-[10px] transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </div>

      {expanded && (
        <div className="border-t border-border1">

          {/* Recent trades */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-text3 uppercase font-semibold tracking-wide">Recent Trades</span>
              <button onClick={onRefreshTrades} className="text-[10px] text-accent hover:underline flex items-center gap-1">↻ Refresh</button>
            </div>
            {tradesLoading ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <div className="w-4 h-4 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-[11px] text-text3">Loading trades...</span>
              </div>
            ) : trades.length === 0 ? (
              <div className="text-center py-6 text-[12px] text-text3">No recent trades found</div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {trades.map((t, i) => {
                  const { label, isLong } = sideLabel(t.side);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const pnl = Number((t as any).pnl ?? t.realized_pnl ?? 0);
                  const isOpenTrade = t.side?.includes('open') || t.side === 'bid' || t.side === 'ask' || t.side?.includes('long') || t.side?.includes('short');
                  return (
                    <div key={t.id || i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface2 border border-border1 hover:border-border2 transition-colors group">
                      <CoinLogo symbol={t.symbol} size={24} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-text1">{t.symbol}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>{label}</span>
                        </div>
                        <div className="text-[10px] text-text3 font-mono">${fmtPrice(t.price)} · {fmt(Number(t.amount), 4)} · {fmtTime(t.created_at)}</div>
                      </div>
                      {pnl !== 0 && (
                        <span className={`text-[11px] font-semibold font-mono ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                          {pnl >= 0 ? '+' : ''}{fmtN(pnl)}
                        </span>
                      )}
                      {isOpenTrade && (
                        <button onClick={() => onCopyTrade(t)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-accent text-white text-[10px] font-bold px-2.5 py-1 rounded-lg hover:bg-accent/90 shrink-0">
                          🔁 Copy
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface CopyTradingProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  wallet: string | null;
  accountInfo: AccountInfo | null;
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  ensureBuilderApproved: () => Promise<boolean>;
}

export function CopyTrading({ markets, tickers, wallet, accountInfo, onToast, ensureBuilderApproved }: CopyTradingProps) {
  const { signMessage } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();

  const {
    leaderboard,
    lbLoading, lbError, fetchLeaderboard,
    sortField, sortDir, toggleSort,
    searchQuery, setSearchQuery,
    page, setPage, totalPages, pagedList, globalStart, filteredTotal,
    favorites, isFavorite, toggleFavorite, updateFavorite, removeFavorite,
    traderTrades, tradesLoading, fetchTraderTrades,
    
  } = useCopyTrading();

  const [activeTab, setActiveTab] = useState<'leaderboard' | 'favorites'>('leaderboard');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    minPnl7d: '', minPnl30d: '', minPnlAll: '',
    minVolume: '', minEquity: '',
    onlyProfitable: false,
  });
  const [copyModal, setCopyModal] = useState<{ trade: TraderTrade; traderAddress: string; fav?: FavoriteTrader } | null>(null);
  const [selectedTrader, setSelectedTrader] = useState<string | null>(null);
  const [drawerAccount, setDrawerAccount] = useState<import('@/lib/pacifica').AccountInfo | null>(null);
  const [drawerPositions, setDrawerPositions] = useState<import('@/lib/pacifica').Position[]>([]);
  const [drawerEquityHist, setDrawerEquityHist] = useState<import('@/lib/pacifica').EquityHistory[]>([]);
  const [drawerTradeHist, setDrawerTradeHist] = useState<import('@/lib/pacifica').TradeHistory[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerPortfolio, setDrawerPortfolio] = useState<PortfolioStats | null>(null);
  const [drawerTab, setDrawerTab] = useState<'positions' | 'open_orders' | 'trade_history'>('positions');
  const [drawerSort, setDrawerSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: '', dir: 'desc' });
  // Auto panel: which position is showing the auto settings
  function toggleDrawerSort(key: string) {
    setDrawerSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }
  function sortDrawer<T>(arr: T[], getter: (item: T) => number | string): T[] {
    if (!drawerSort.key) return arr;
    return [...arr].sort((a, b) => {
      const va = getter(a), vb = getter(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return drawerSort.dir === 'asc' ? cmp : -cmp;
    });
  }

  const [drawerOpenOrders, setDrawerOpenOrders] = useState<import('@/lib/pacifica').OpenOrder[]>([]);
  const [drawerOrderHistory, setDrawerOrderHistory] = useState<import('@/lib/pacifica').OpenOrder[]>([]);
  const [drawerFundingHistory, setDrawerFundingHistory] = useState<import('@/lib/pacifica').FundingHistory[]>([]);

  // O(1) lookup map for leaderboard entries by address
  const leaderboardMap = new Map<string, LeaderboardEntry>(leaderboard.map(e => [e.account, e]));

  // Apply filters to FULL leaderboard first, then slice for current page
  const hasActiveFilters = Object.values(filters).some(v => v !== '' && v !== false);
  const filteredLeaderboard = hasActiveFilters ? leaderboard.filter(e => {
    if (filters.minPnl7d && e.pnl_7d < Number(filters.minPnl7d)) return false;
    if (filters.minPnl30d && e.pnl_30d < Number(filters.minPnl30d)) return false;
    if (filters.minPnlAll && e.pnl_all < Number(filters.minPnlAll)) return false;
    if (filters.minVolume && e.volume_30d < Number(filters.minVolume)) return false;
    if (filters.minEquity && e.equity_current < Number(filters.minEquity)) return false;
    if (filters.onlyProfitable && e.pnl_30d <= 0) return false;
    return true;
  }) : pagedList;
  // When filters active: paginate filtered full list; otherwise use hook's pagedList
  const PAGE_SIZE_FILTER = 50;
  const filteredTotalPages = hasActiveFilters ? Math.ceil(filteredLeaderboard.length / PAGE_SIZE_FILTER) : totalPages;
  const filteredPagedList = hasActiveFilters
    ? filteredLeaderboard.slice(page * PAGE_SIZE_FILTER, (page + 1) * PAGE_SIZE_FILTER)
    : pagedList;

  const myBalance = accountInfo ? Number(accountInfo.available_to_spend || accountInfo.balance || 0) : 0;
  const { addEntry, updateEntry } = useOrderLog(wallet);

  // Position mirroring

  // ── Build signer ──────────────────────────────────────────────────────────

  const buildSignFn = useCallback(() => {
    return async (msgBytes: Uint8Array): Promise<string> => {
      const solanaWallet = solanaWallets.find(w => w.address === wallet) || solanaWallets[0];
      if (solanaWallet) {
        const sigResult = await solanaWallet.signMessage(msgBytes);
        if (typeof sigResult === 'string') return sigResult;
        return toBase58(sigResult as unknown as Uint8Array);
      } else if (signMessage) {
        const msgStr = new TextDecoder().decode(msgBytes);
        const result = await signMessage(msgStr);
        return typeof result === 'string' ? result : toBase58(result as unknown as Uint8Array);
      }
      throw new Error('No signing method available');
    };
  }, [solanaWallets, wallet, signMessage]);


  // ── Open trader drawer ───────────────────────────────────────────────────
  async function openTraderDrawer(account: string) {
    setSelectedTrader(account);
    setDrawerTab('positions');
    setDrawerLoading(true);
    setDrawerAccount(null);
    setDrawerPositions([]);
    setDrawerEquityHist([]);
    setDrawerTradeHist([]);
    setDrawerPortfolio(null);
    setDrawerOpenOrders([]);
    setDrawerOrderHistory([]);
    setDrawerFundingHistory([]);
    const [acct, pos, eq, trades, allOrders] = await Promise.all([
      getAccountInfo(account),
      getPositions(account),
      getEquityHistory(account),
      getTradesHistory(account, 50),
      getOrderHistory(account, 100),
    ]);
    const portfolio = null; // portfolio endpoint not available for other accounts
    setDrawerAccount(acct);
    setDrawerPositions(pos);
    setDrawerEquityHist(eq);
    setDrawerTradeHist(trades);
    setDrawerPortfolio(null); // portfolio endpoint unavailable
    // Open orders = order_status === 'open' from orders/history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setDrawerOpenOrders(allOrders.filter((o: any) => (o.order_status ?? o.status) === 'open'));
    setDrawerOrderHistory([]);
    setDrawerFundingHistory([]);
    setDrawerLoading(false);
  }


  // ── Manual copy handler ───────────────────────────────────────────────────

  async function handleManualCopy(
    trade: TraderTrade,
    traderAddress: string,
    amount: number,
    leverage: number,
    orderType: 'market' | 'limit',
    limitPrice?: string,
    slPrice?: number | null,
    tpPrice?: number | null,
  ) {
    if (!wallet) { onToast('Connect your wallet first', 'error'); return; }
    const approved = await ensureBuilderApproved();
    if (!approved) return;

    const market = markets.find(m => m.symbol === trade.symbol);
    const { isLong } = sideLabel(trade.side);
    const tk = tickers[trade.symbol];
    const markPrice = getMarkPrice(tk);
    const entryPrice = orderType === 'market' ? markPrice : (Number(limitPrice) || markPrice);
    const contracts = entryPrice > 0 ? (amount * leverage) / entryPrice : 0;
    const decimals = market?.lot_size
      ? Math.max(0, Math.ceil(-Math.log10(Number(market.lot_size))))
      : 4;

    // Log order
    const logId = addEntry({
      symbol: trade.symbol,
      side: isLong ? 'bid' : 'ask',
      amount: contracts.toFixed(decimals),
      price: String(entryPrice.toFixed(4)),
      orderType,
      status: 'pending',
      source: 'copy',
      traderAddress,
    });

    const slTpStr = [slPrice ? `SL $${slPrice.toFixed(2)}` : null, tpPrice ? `TP $${tpPrice.toFixed(2)}` : null].filter(Boolean).join(' · ');
    onToast(`Placing ${isLong ? 'LONG' : 'SHORT'} ${trade.symbol} ${leverage}×${slTpStr ? ' · ' + slTpStr : ''}...`, 'info');

    try {
      const signFn = buildSignFn();
      let result;

      if (orderType === 'market') {
        result = await submitMarketOrder(wallet, {
          symbol: trade.symbol,
          amount: contracts.toFixed(decimals),
          side: isLong ? 'bid' : 'ask',
          reduce_only: false,
          slippage_percent: '1',
          ...(slPrice ? { stop_loss: { stop_price: slPrice.toFixed(4) } } : {}),
          ...(tpPrice ? { take_profit: { stop_price: tpPrice.toFixed(4) } } : {}),
        }, signFn);
      } else {
        result = await submitLimitOrder(wallet, {
          symbol: trade.symbol,
          price: limitPrice || String(markPrice),
          amount: contracts.toFixed(decimals),
          side: isLong ? 'bid' : 'ask',
          tif: 'GTC',
          reduce_only: false,
          ...(slPrice ? { stop_loss: { stop_price: slPrice.toFixed(4) } } : {}),
          ...(tpPrice ? { take_profit: { stop_price: tpPrice.toFixed(4) } } : {}),
        }, signFn);
      }

      if (result.success) {
        updateEntry(logId, { status: 'success', orderId: result.orderId });
        onToast(`✓ ${trade.symbol} ${isLong ? 'Long' : 'Short'} placed!`, 'success');
      } else {
        updateEntry(logId, { status: 'failed', error: result.error });
        onToast(`Order error: ${result.error}`, 'error');
      }
    } catch (e) {
      onToast(`Error: ${String(e)}`, 'error');
    }
  }

  // ─── Sort columns config ──────────────────────────────────────────────────

  const sortCols: { label: string; field: SortField }[] = [
    { label: 'PnL 7D', field: 'pnl_7d' },
    { label: 'PnL 30D', field: 'pnl_30d' },
    { label: 'PnL All Time', field: 'pnl_all' },
    { label: 'Vol 7D', field: 'volume_7d' },
    { label: 'Vol 30D', field: 'volume_30d' },
    { label: 'Vol All Time', field: 'volume_all' },
    { label: 'Equity', field: 'equity_current' },
    { label: 'Open Int.', field: 'oi_current' },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  // ── Mini sparkline for equity history ────────────────────────────────────
  function Sparkline({ data }: { data: { equity: string }[] }) {
    if (!data.length) return <div className="h-10 text-[10px] text-text3 flex items-center">No data</div>;
    const vals = data.map(d => Number(d.equity));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const w = 280, h = 48;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
    const isUp = vals[vals.length - 1] >= vals[0];
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        <polyline points={pts} fill="none" stroke={isUp ? 'var(--success)' : 'var(--danger)'} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content — shrinks when drawer open */}
      <div className={`flex flex-col overflow-hidden transition-all duration-300 ${selectedTrader ? 'flex-1 min-w-0' : 'flex-1'}`}>

      {/* Top bar — all inside max-w-[1280px] wrapper */}
      <div className="border-b border-border1 bg-surface shrink-0">
        <div className="max-w-[1280px] mx-auto px-6 py-3 flex items-center gap-4">
          {/* Tab switcher */}
          <div className="flex bg-surface2 border border-border1 rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ${
                activeTab === 'leaderboard' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2'
              }`}>
              Leaderboard
            </button>
            <button
              onClick={() => setActiveTab('favorites')}
              className={`px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'favorites' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2'
              }`}>
              Watching
              {favorites.length > 0 && (
                <span className="bg-accent text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {favorites.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'leaderboard' && (
            <>
              {/* Search */}
              <div className="relative flex-1 max-w-64">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text3 text-[12px]">🔍</span>
                <input
                  type="text"
                  placeholder="Search wallet..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
                  className="w-full bg-surface2 border border-border1 rounded-xl pl-8 pr-3 py-1.5 text-[12px] text-text1 outline-none focus:border-accent transition-colors placeholder-text3"
                />
              </div>

              <div className="ml-auto flex items-center gap-3 shrink-0">
                <button onClick={() => setShowFilters(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-semibold transition-all ${
                    showFilters || hasActiveFilters
                      ? 'bg-accent/10 border-accent/30 text-accent'
                      : 'border-border1 text-text3 hover:border-accent/40 hover:text-accent'
                  }`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                  Filter
                  {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                </button>
                <span className="text-[11px] text-text3">
                  {hasActiveFilters
                    ? `${filteredLeaderboard.length.toLocaleString()} / ${leaderboard.length.toLocaleString()} traders`
                    : `${leaderboard.length.toLocaleString()} traders`
                  }
                </span>
                <button onClick={fetchLeaderboard} disabled={lbLoading}
                  className="flex items-center gap-1.5 text-[11px] text-accent hover:underline disabled:opacity-50">
                  {lbLoading
                    ? <><div className="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" /> Loading...</>
                    : <>↻ Refresh</>
                  }
                </button>
              </div>
            </>
          )}
        </div>

        {/* Filter panel */}
        {showFilters && activeTab === 'leaderboard' && (
          <div className="border-t border-border1 bg-surface2">
            <div className="max-w-[1280px] mx-auto px-6 py-3">
              <div className="grid grid-cols-6 gap-3 items-end">
                {[
                  { label: 'Min PnL 7D ($)', key: 'minPnl7d' },
                  { label: 'Min PnL 30D ($)', key: 'minPnl30d' },
                  { label: 'Min PnL All Time ($)', key: 'minPnlAll' },
                  { label: 'Min Vol 30D ($)', key: 'minVolume' },
                  { label: 'Min Equity ($)', key: 'minEquity' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">{f.label}</label>
                    <input type="number" placeholder="0"
                      value={filters[f.key as keyof typeof filters] as string}
                      onChange={e => { setFilters(prev => ({ ...prev, [f.key]: e.target.value })); setPage(0); }}
                      className="w-full bg-surface border border-border1 rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-text1 outline-none focus:border-accent transition-colors" />
                  </div>
                ))}
                <div className="flex flex-col gap-2">
                  <button onClick={() => { setFilters(prev => ({ ...prev, onlyProfitable: !prev.onlyProfitable })); setPage(0); }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
                      filters.onlyProfitable ? 'bg-success/10 border-success/30 text-success' : 'border-border1 text-text3 hover:border-border2'
                    }`}>
                    <div className={`relative w-7 h-4 rounded-full transition-all ${filters.onlyProfitable ? 'bg-success' : 'bg-border2'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${filters.onlyProfitable ? 'translate-x-3' : ''}`} />
                    </div>
                    Profitable only
                  </button>
                  {hasActiveFilters && (
                    <button onClick={() => { setFilters({ minPnl7d: '', minPnl30d: '', minPnlAll: '', minVolume: '', minEquity: '', onlyProfitable: false }); setPage(0); }}
                      className="text-[11px] text-danger hover:underline text-left">
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-bg">
        <div className="w-full max-w-[1280px] mx-auto">

        {/* ── LEADERBOARD TAB ── */}
        {activeTab === 'leaderboard' && (
          <>
            {lbError && (
              <div className="m-4 p-4 bg-danger/5 border border-danger/20 rounded-xl text-[12px] text-danger">
                ⚠ {lbError}
              </div>
            )}

            {lbLoading && !pagedList.length ? (
              <div className="flex items-center justify-center flex-1 h-64 gap-3">
                <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-[12px] text-text3">Loading leaderboard...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-surface2 border-b border-border1 z-10">
                    <tr>
                      <th className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-left w-8">#</th>
                      <th className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-left">Trader</th>
                      {sortCols.map(c => (
                        <Th key={c.field} label={c.label} field={c.field}
                          cur={sortField} dir={sortDir} onClick={() => toggleSort(c.field)} />
                      ))}
                      <th className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-center">Watch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPagedList.map((entry: LeaderboardEntry, i: number) => {
                      const rank = globalStart + i + 1;
                      const faved = isFavorite(entry.account);
                      return (
                        <tr key={entry.account}
                          onClick={() => openTraderDrawer(entry.account)}
                          className="border-b border-border1 last:border-0 hover:bg-surface2/60 transition-colors group cursor-pointer">
                          <td className="px-3 py-2 text-[11px] text-text3 font-mono">{rank}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
                                {entry.account.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="text-[12px] font-mono text-text1 font-semibold">{fmtShortAddr(entry.account)}</div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.account); }}
                                  className="text-[9px] text-text3 hover:text-accent transition-colors opacity-0 group-hover:opacity-100">
                                  Copy address
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* PnL cols */}
                          {(['pnl_7d', 'pnl_30d', 'pnl_all'] as const).map(f => (
                            <td key={f} className={`px-3 py-2 text-right text-[12px] font-mono font-semibold ${
                              entry[f] >= 0 ? 'text-success' : 'text-danger'
                            } ${sortField === f ? 'bg-accent/3' : ''}`}>
                              {fmtN(entry[f], true)}
                            </td>
                          ))}

                          {/* Volume cols */}
                          {(['volume_7d', 'volume_30d', 'volume_all'] as const).map(f => (
                            <td key={f} className={`px-3 py-2 text-right text-[12px] font-mono text-text2 ${
                              sortField === f ? 'bg-accent/3' : ''
                            }`}>
                              {fmtN(entry[f])}
                            </td>
                          ))}

                          {/* Equity */}
                          <td className={`px-3 py-2 text-right text-[12px] font-mono text-text2 ${
                            sortField === 'equity_current' ? 'bg-accent/3' : ''
                          }`}>
                            {fmtN(entry.equity_current)}
                          </td>

                          {/* OI */}
                          <td className={`px-3 py-2 text-right text-[12px] font-mono text-text2 ${
                            sortField === 'oi_current' ? 'bg-accent/3' : ''
                          }`}>
                            {fmtN(entry.oi_current)}
                          </td>

                          {/* Favorite button */}
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleFavorite(entry.account); }}
                              title={faved ? 'Remove from watchlist' : 'Add to watchlist'}
                              className={`w-8 h-8 flex items-center justify-center mx-auto rounded-lg transition-all text-[14px] ${
                                faved
                                  ? 'text-warn bg-warn/10 border border-warn/30 hover:bg-warn/20'
                                  : 'text-text3 hover:text-warn hover:bg-warn/5 border border-transparent hover:border-warn/20'
                              }`}>
                              {faved ? '★' : '☆'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-border1 flex items-center justify-between">
                <span className="text-[11px] text-text3">
                  Page {page + 1} / {totalPages} · {filteredTotal.toLocaleString()} results
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPage(0)} disabled={page === 0}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    «
                  </button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    ‹
                  </button>
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    const p = Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-8 py-1 text-[11px] rounded-lg border transition-all ${
                          p === page
                            ? 'bg-accent text-white border-accent'
                            : 'text-text2 bg-surface2 border-border1 hover:border-accent/40'
                        }`}>
                        {p + 1}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    ›
                  </button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    »
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── FAVORITES TAB ── */}
        {activeTab === 'favorites' && (
          <div className="p-4 space-y-3">

            {/* Builder code info banner */}
            <div className="flex items-center gap-3 px-4 py-3 bg-accent/5 border border-accent/20 rounded-xl">
              <span className="text-lg">🔑</span>
              <div>
                <div className="text-[12px] font-semibold text-text1">Builder Code Active</div>
                <div className="text-[10px] text-text3">
                  All copy trades use builder code <span className="font-mono text-accent">PACIFICALENS</span>. No extra approval needed per trade.
                </div>
              </div>
            </div>

            {favorites.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3"></div>
                <div className="text-[14px] font-semibold text-text2 mb-1">No traders in watchlist</div>
                <div className="text-[12px] text-text3">
                  Go to the Leaderboard tab and click ☆ next to any trader to start watching.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {favorites.map(fav => {
                  const lbEntry = leaderboardMap.get(fav.account);
                  return (
                    <FavoriteCard
                      key={fav.account}
                      fav={fav}
                      lbEntry={lbEntry}
                      trades={traderTrades[fav.account] || []}
                      tradesLoading={!!tradesLoading[fav.account]}
                      tickers={tickers}
                      onRemove={() => removeFavorite(fav.account)}
                      onCopyTrade={trade => setCopyModal({ trade, traderAddress: fav.account, fav })}
                      onRefreshTrades={() => fetchTraderTrades(fav.account)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
        </div>{/* end max-w */}
        {/* Copy trade modal */}
        {copyModal && (
          <CopyTradeModal
            trade={copyModal.trade}
            traderAddress={copyModal.traderAddress}
            markets={markets}
            tickers={tickers}
            myBalance={myBalance}
            defaultAmount={copyModal.fav?.copyAmount || 100}
            onConfirm={async (amount, leverage, orderType, limitPrice, sl, tp) => {
              await handleManualCopy(copyModal.trade, copyModal.traderAddress, amount, leverage, orderType, limitPrice, sl, tp);
            }}
            onClose={() => setCopyModal(null)}
          />
        )}
      </div>{/* end main */}

      {/* ── Trader Detail Drawer ────────────────────────────────────────── */}
      {selectedTrader && (() => {
        const lbEntry = leaderboardMap.get(selectedTrader);
        const faved = isFavorite(selectedTrader);
        const isCopyFav = favorites.find(f => f.account === selectedTrader);
        return (
          <div className="w-[540px] shrink-0 border-l border-border1 bg-surface flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[11px] font-bold text-accent">
                  {selectedTrader.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-text1 font-mono">{fmtShortAddr(selectedTrader)}</div>
                  <button onClick={() => navigator.clipboard.writeText(selectedTrader)}
                    className="text-[10px] text-text3 hover:text-accent transition-colors">
                    Copy address
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleFavorite(selectedTrader)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                    faved
                      ? 'bg-warn/10 text-warn border-warn/30 hover:bg-warn/20'
                      : 'bg-surface text-text3 border-border1 hover:border-accent/40 hover:text-accent'
                  }`}>
                  {faved ? 'Watching' : '☆ Watch'}
                </button>
                <button onClick={() => setSelectedTrader(null)}
                  className="w-7 h-7 flex items-center justify-center text-text3 hover:text-text1 hover:bg-surface rounded-lg transition-colors text-[16px]">
                  ×
                </button>
              </div>
            </div>

            {drawerLoading ? (
              <div className="flex items-center justify-center flex-1 gap-3">
                <div className="w-5 h-5 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-[12px] text-text3">Loading portfolio...</span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">

                {/* ── Top 4 stat cards — 2. fotoğraf layout ── */}
                <div className="p-3 grid grid-cols-2 gap-2 border-b border-border1">
                  {[
                    { label: 'Account Equity',    value: drawerAccount ? `$${Number(drawerAccount.account_equity).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—', accent: true },
                    { label: 'Available Balance', value: drawerAccount ? `$${Number(drawerAccount.balance).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—' },
                    { label: 'Margin Used',       value: drawerAccount ? `$${Number(drawerAccount.total_margin_used).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—' },
                    { label: 'Open Positions',    value: drawerAccount ? String(drawerAccount.positions_count) : String(drawerPositions.length) },
                  ].map(s => (
                    <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-3 py-2.5">
                      <div className="text-[9px] text-text3 uppercase tracking-wide mb-1">{s.label}</div>
                      <div className={`text-[15px] font-bold ${s.accent ? 'text-accent' : 'text-text1'}`}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* ── Performance grid — 2. fotoğraf layout ── */}
                {lbEntry && (
                  <div className="p-3 border-b border-border1">
                    <div className="text-[10px] text-text3 uppercase tracking-wide font-semibold mb-2">Performance</div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'PnL 7D',    value: lbEntry.pnl_7d,      isPnl: true },
                        { label: 'PnL 30D',   value: lbEntry.pnl_30d,     isPnl: true },
                        { label: 'PnL All',   value: lbEntry.pnl_all,     isPnl: true },
                        { label: 'Vol 7D',    value: lbEntry.volume_7d,   isPnl: false },
                        { label: 'Vol 30D',   value: lbEntry.volume_30d,  isPnl: false },
                        { label: 'Open Int.', value: lbEntry.oi_current,  isPnl: false },
                      ].map(s => (
                        <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-2.5 py-2 text-center">
                          <div className="text-[9px] text-text3 uppercase tracking-wide mb-1">{s.label}</div>
                          <div className={`text-[13px] font-bold font-mono ${s.isPnl ? (s.value >= 0 ? 'text-success' : 'text-danger') : 'text-text1'}`}>
                            {fmtN(s.value, s.isPnl)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Tab bar ── */}
                <div className="border-b border-border1 px-3 pt-2 flex gap-0 overflow-x-auto">
                  {([
                    { key: 'positions',      label: `Positions (${drawerPositions.length})` },
                    { key: 'open_orders',    label: `Open Orders (${drawerOpenOrders.length || drawerAccount?.orders_count || 0})` },
                    { key: 'trade_history',  label: 'Trade History' },
                  ] as const).map(t => (
                    <button key={t.key} onClick={() => setDrawerTab(t.key)}
                      className={`px-3 py-2 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-all -mb-px ${
                        drawerTab === t.key
                          ? 'border-accent text-accent'
                          : 'border-transparent text-text3 hover:text-text2'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* ── Tab content ── */}
                <div className="p-3">

                  {/* POSITIONS */}
                  {drawerTab === 'positions' && (
                    drawerPositions.length === 0
                      ? <div className="text-center py-8 text-[12px] text-text3">No open positions</div>
                      : <div className="space-y-2">
                          {drawerPositions.map((pos, i) => {
                            const isLong = pos.side === 'bid';
                            const tk = tickers[pos.symbol];
                            const markPx = getMarkPrice(tk);
                            const entryPx = Number(pos.entry_price || 0);
                            const amt = Number(pos.amount || 0);
                            // Use unrealized_pnl if available, else compute from mark price
                            const rawPnl = Number(pos.unrealized_pnl ?? 'x');
                            const pnl = isNaN(rawPnl) || pos.unrealized_pnl == null
                              ? (markPx > 0 && entryPx > 0 ? (isLong ? 1 : -1) * (markPx - entryPx) * amt : 0)
                              : rawPnl;
                            const posVal = entryPx * amt;
                            const marginVal = Number(pos.margin || 0);
                            const pnlPct = posVal > 0 ? (pnl / posVal * 100) : 0;
                            return (
                              <div key={i} className="bg-surface2 border border-border1 rounded-xl px-3 py-2.5">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-bold text-text1">{pos.symbol}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isLong ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
                                      {isLong ? 'Long' : 'Short'}
                                    </span>


                                  </div>
                                  <span className={`text-[13px] font-bold font-mono ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                    {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 2 })} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] mb-2">
                                  <div className="flex justify-between"><span className="text-text3">Size</span><span className="text-text2 font-mono">{Number(pos.amount).toFixed(4)} {pos.symbol}</span></div>
                                  <div className="flex justify-between"><span className="text-text3">Mark Price</span><span className="text-text2 font-mono">${fmtPrice(getMarkPrice(tk))}</span></div>
                                  <div className="flex justify-between"><span className="text-text3">Entry / Breakeven</span><span className="text-text2 font-mono">${fmtPrice(Number(pos.entry_price))}</span></div>
                                  <div className="flex justify-between"><span className="text-text3">Margin</span><span className="text-text2 font-mono">{pos.isolated ? 'Isolated' : 'Cross'}{pos.margin ? ` $${Number(pos.margin).toFixed(2)}` : ''}</span></div>
                                  {pos.liquidation_price && <div className="flex justify-between col-span-2"><span className="text-text3">Liq. Price</span><span className="text-danger font-mono">${fmtPrice(Number(pos.liquidation_price))}</span></div>}
                                </div>
                                <button onClick={() => setCopyModal({ trade: { symbol: pos.symbol, side: isLong ? 'open_long' : 'open_short', price: pos.entry_price, amount: pos.amount, created_at: pos.created_at }, traderAddress: selectedTrader!, fav: isCopyFav })}
                                  className="w-full py-1.5 bg-accent/10 text-accent border border-accent/20 rounded-lg text-[11px] font-semibold hover:bg-accent/20 transition-colors">
                                  Copy this position
                                </button>
                              </div>
                            );
                          })}
                        </div>
                  )}

                  {/* OPEN ORDERS */}
                  {drawerTab === 'open_orders' && (
                    drawerOpenOrders.length === 0
                      ? <div className="text-center py-8 text-[12px] text-text3">No open orders</div>
                      : <div>
                          <div className="grid grid-cols-5 gap-2 px-2 py-1.5 border-b border-border1 bg-surface2">
                            {[['oo_sym','Symbol'],['oo_side','Side'],['oo_type','Type'],['oo_price','Price'],['oo_amt','Amount']].map(([k,l]) => (
                              <button key={k} onClick={() => toggleDrawerSort(k)}
                                className={`text-left text-[9px] font-semibold uppercase tracking-wide flex items-center gap-0.5 transition-colors hover:text-accent ${drawerSort.key===k?'text-accent':'text-text3'} ${k==='oo_price'||k==='oo_amt'?'justify-end':''}`}>
                                {l}<span className="text-[7px]">{drawerSort.key===k?(drawerSort.dir==='desc'?'▼':'▲'):'⇅'}</span>
                              </button>
                            ))}
                          </div>
                          {sortDrawer(drawerOpenOrders, (o) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const price = (o as any).initial_price ?? (o as any).average_filled_price ?? o.price ?? '0';
                            if (drawerSort.key==='oo_sym') return o.symbol;
                            if (drawerSort.key==='oo_side') return o.side;
                            if (drawerSort.key==='oo_type') return o.order_type??'';
                            if (drawerSort.key==='oo_price') return Number(price);
                            if (drawerSort.key==='oo_amt') return Number(o.amount);
                            return 0;
                          }).map((o, i) => {
                            const { label, isLong } = sideLabel(o.side);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const price = (o as any).initial_price ?? (o as any).average_filled_price ?? o.price ?? '0';
                            return (
                              <div key={i} className="grid grid-cols-5 gap-2 px-2 py-2 border-b border-border1 last:border-0 text-[11px] hover:bg-surface2/60 transition-colors">
                                <span className="font-semibold text-text1">{o.symbol}</span>
                                <span className={isLong ? 'text-success font-semibold' : 'text-danger font-semibold'}>{label}</span>
                                <span className="text-text3 uppercase">{o.order_type ?? 'limit'}</span>
                                <span className="text-right font-mono text-text2">${fmtPrice(Number(price))}</span>
                                <span className="text-right font-mono text-text2">{Number(o.amount).toFixed(4)}</span>
                              </div>
                            );
                          })}
                        </div>
                  )}

                  {/* TRADE HISTORY */}
                  {drawerTab === 'trade_history' && (
                    drawerTradeHist.length === 0
                      ? <div className="text-center py-8 text-[12px] text-text3">No trade history</div>
                      : <div>
                          <div className="grid grid-cols-5 gap-2 px-2 py-1.5 border-b border-border1 bg-surface2">
                            {[['th_sym','Symbol'],['th_side','Side'],['th_price','Price'],['th_size','Size'],['th_pnl','Realized PnL']].map(([k,l]) => (
                              <button key={k} onClick={() => toggleDrawerSort(k)}
                                className={`text-left text-[9px] font-semibold uppercase tracking-wide flex items-center gap-0.5 transition-colors hover:text-accent ${drawerSort.key===k?'text-accent':'text-text3'} ${k!=='th_sym'&&k!=='th_side'?'justify-end':''}`}>
                                {l}<span className="text-[7px]">{drawerSort.key===k?(drawerSort.dir==='desc'?'▼':'▲'):'⇅'}</span>
                              </button>
                            ))}
                          </div>
                          {sortDrawer(drawerTradeHist, (t) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const pnl = Number((t as any).pnl ?? t.realized_pnl ?? 0);
                            if (drawerSort.key==='th_sym') return t.symbol;
                            if (drawerSort.key==='th_side') return t.side;
                            if (drawerSort.key==='th_price') return Number(t.price);
                            if (drawerSort.key==='th_size') return Number(t.amount);
                            if (drawerSort.key==='th_pnl') return pnl;
                            return 0;
                          }).map((t, i) => {
                            const { label, isLong } = sideLabel(t.side);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const pnl = Number((t as any).pnl ?? t.realized_pnl ?? 0);
                            return (
                              <div key={i} className="grid grid-cols-5 gap-2 px-2 py-2 border-b border-border1 last:border-0 text-[11px] hover:bg-surface2/60 transition-colors">
                                <span className="font-semibold text-text1">{t.symbol}</span>
                                <span className={isLong ? 'text-success font-semibold' : 'text-danger font-semibold'}>{label}</span>
                                <span className="text-right font-mono text-text2">${fmtPrice(Number(t.price))}</span>
                                <span className="text-right font-mono text-text2">{Number(t.amount).toFixed(3)}</span>
                                <span className={`text-right font-mono font-semibold ${pnl > 0 ? 'text-success' : pnl < 0 ? 'text-danger' : 'text-text3'}`}>
                                  {pnl !== 0 ? `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}` : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                  )}



                </div>

                {!drawerLoading && !drawerAccount && !drawerPortfolio && (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                    <div className="text-[12px] text-text3">No portfolio data available for this trader.</div>
                  </div>
                )}

              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
// ─── Copy Trade Modal ─────────────────────────────────────────────────────────
function CopyTradeModal({
  trade, traderAddress, markets, tickers, myBalance, defaultAmount, onConfirm, onClose,
}: {
  trade: TraderTrade;
  traderAddress: string;
  markets: Market[];
  tickers: Record<string, Ticker>;
  myBalance: number;
  defaultAmount: number;
  onConfirm: (
    amount: number,
    leverage: number,
    orderType: 'market' | 'limit',
    limitPrice?: string,
    sl?: number | null,
    tp?: number | null
  ) => Promise<void>;
  onClose: () => void;
}) {
  const { label, isLong } = sideLabel(trade.side);
  const market = markets.find(m => m.symbol === trade.symbol);
  const tk = tickers[trade.symbol];
  const markPrice = getMarkPrice(tk);
  const traderEntry = Number(trade.price || markPrice);
  const maxLev = Number(market?.max_leverage || 20);

  const [amount, setAmount] = useState(Math.min(defaultAmount, myBalance || defaultAmount));
  const [leverage, setLeverage] = useState(Math.min(5, maxLev));
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState(String(traderEntry));
  const [slEnabled, setSlEnabled] = useState(false);
  const [slPct, setSlPct] = useState(5);
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpPct, setTpPct] = useState(10);
  const [placing, setPlacing] = useState(false);

  const entryPrice = orderType === 'market' ? markPrice : (Number(limitPrice) || markPrice);
  const positionValue = amount * leverage;
  const liqPrice = entryPrice > 0 && leverage > 0
    ? isLong
      ? entryPrice * (1 - 0.9 / leverage)
      : entryPrice * (1 + 0.9 / leverage)
    : 0;
  const slPrice = slEnabled && entryPrice > 0
    ? (isLong ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100))
    : null;
  const tpPrice = tpEnabled && entryPrice > 0
    ? (isLong ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100))
    : null;
  const isHighLeverage = leverage > 20;
  const presets = [25, 50, 100, 250, 500].filter(p => myBalance <= 0 || p <= myBalance * 2);

  const leveragePct = ((leverage - 1) / (maxLev - 1)) * 100;

  async function handleConfirm() {
    setPlacing(true);
    await onConfirm(amount, leverage, orderType, orderType === 'limit' ? limitPrice : undefined, slPrice, tpPrice);
    setPlacing(false);
    onClose();
  }

  function TipIcon({ text }: { text: string }) {
    const [show, setShow] = useState(false);
    return (
      <span className="relative inline-flex items-center"
        onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
        <span className="w-3.5 h-3.5 rounded-full border border-border2 text-text3 flex items-center justify-center text-[8px] font-bold cursor-help hover:border-accent hover:text-accent transition-colors">?</span>
        {show && (
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 bg-surface border border-border1 rounded-lg px-2.5 py-2 text-[10px] text-text2 leading-relaxed shadow-card-md z-[200] pointer-events-none whitespace-normal">
            {text}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-surface border border-border1 rounded-2xl shadow-card-md w-[420px] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`px-5 py-4 border-b border-border1 flex items-center justify-between ${isLong ? 'bg-success/5' : 'bg-danger/5'}`}>
          <div className="flex items-center gap-3">
            <CoinLogo symbol={trade.symbol} size={32} />
            <div>
              <div className="text-[14px] font-bold text-text1">{trade.symbol}-PERP · {label}</div>
              <div className="text-[10px] text-text3 font-mono">{fmtShortAddr(traderAddress)}</div>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface2 text-text3 text-lg transition-colors">
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">

          {/* Price comparison */}
          <div className="grid grid-cols-3 divide-x divide-border1 bg-surface2 border border-border1 rounded-xl overflow-hidden">
            {[
              { label: 'Trader Entry', value: '$' + fmtPrice(traderEntry), color: 'text-text1' },
              { label: 'Mark Price', value: '$' + fmtPrice(markPrice), color: markPrice > traderEntry ? 'text-success' : 'text-danger' },
              { label: 'Price Drift', value: traderEntry > 0 ? ((markPrice - traderEntry) / traderEntry * 100).toFixed(2) + '%' : '—',
                color: 'text-text3' },
            ].map(s => (
              <div key={s.label} className="px-3 py-2 text-center">
                <div className="text-[9px] text-text3 uppercase tracking-wide">{s.label}</div>
                <div className={`text-[12px] font-mono font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Margin */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-text1">Margin</span>
                <TipIcon text="Your collateral in USDC. The actual position size is Margin × Leverage." />
              </div>
              {myBalance > 0 && (
                <span className="text-[10px] text-text3">
                  Balance: <span className="text-accent font-semibold">${fmt(myBalance, 2)}</span>
                </span>
              )}
            </div>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {presets.map(p => (
                <button key={p} onClick={() => setAmount(p)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                    amount === p ? 'bg-accent text-white border-accent' : 'bg-surface2 border-border1 text-text2 hover:border-accent/40'
                  }`}>
                  ${p}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-text3">$</span>
              <input type="number" value={amount} min={1}
                onChange={e => setAmount(Number(e.target.value))}
                className="w-full bg-surface2 border border-border1 rounded-xl pl-6 pr-14 py-2.5 text-[13px] font-mono text-text1 outline-none focus:border-accent transition-colors" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text3">USDC</span>
            </div>
          </div>

          {/* Leverage slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-text1">Leverage</span>
                <TipIcon text={`Multiplies your position size. ${leverage}× means $${positionValue.toFixed(0)} position with $${amount} margin. Higher leverage = higher risk of liquidation.`} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[14px] font-bold font-mono tabular-nums ${isHighLeverage ? 'text-warn' : 'text-accent'}`}>
                  {leverage}×
                </span>
                <span className="text-[10px] text-text3">= ${positionValue.toFixed(0)}</span>
              </div>
            </div>
            {/* Custom slider with colored track */}
            <div className="relative h-5 flex items-center">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-border2" />
              <div
                className={`absolute left-0 h-1.5 rounded-full transition-all ${isHighLeverage ? 'bg-warn' : 'bg-accent'}`}
                style={{ width: `${leveragePct}%` }}
              />
              <input
                type="range" min={1} max={maxLev} value={leverage}
                onChange={e => setLeverage(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-5"
              />
              <div
                className={`absolute w-4 h-4 rounded-full border-2 border-white shadow pointer-events-none transition-all ${isHighLeverage ? 'bg-warn' : 'bg-accent'}`}
                style={{ left: `calc(${leveragePct}% - 8px)` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-text3">1×</span>
              <span className="text-[9px] text-text3">{maxLev}× max</span>
            </div>
            {isHighLeverage && (
              <div className="mt-1.5 px-2.5 py-1.5 bg-warn/8 border border-warn/20 rounded-lg text-[10px] text-warn">
                ⚠ High leverage — liquidation price is close to entry
              </div>
            )}
          </div>

          {/* Order type */}
          <div className="flex bg-surface2 border border-border1 rounded-xl overflow-hidden">
            {(['market', 'limit'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                className={`flex-1 py-2 text-[12px] font-semibold capitalize transition-all ${
                  orderType === t ? 'bg-surface text-text1 shadow-sm' : 'text-text3 hover:text-text2'
                }`}>
                {t}
              </button>
            ))}
          </div>

          {orderType === 'limit' && (
            <div className="relative">
              <input type="number" value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                placeholder="Limit price"
                className="w-full bg-surface2 border border-border1 rounded-xl px-3 py-2.5 text-[13px] font-mono text-text1 outline-none focus:border-accent transition-colors" />
              <button onClick={() => setLimitPrice(String(markPrice))}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-accent hover:underline">
                Mark
              </button>
            </div>
          )}

          {/* Liquidation price */}
          {liqPrice > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-danger/5 border border-danger/20 rounded-xl">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-danger font-semibold">Est. Liquidation</span>
                <TipIcon text="If the price reaches this level, your position will be automatically closed and you will lose your margin. Keep leverage low to keep this price far from entry." />
              </div>
              <span className="text-[12px] font-mono font-bold text-danger">${fmtPrice(liqPrice)}</span>
            </div>
          )}

          {/* SL / TP */}
          <div className="grid grid-cols-2 gap-2">
            {/* Stop Loss */}
            <div className={`border rounded-xl p-3 transition-all ${slEnabled ? 'border-danger/40 bg-danger/5' : 'border-border1'}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button onClick={() => setSlEnabled(v => !v)}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${slEnabled ? 'text-danger' : 'text-text3'}`}>
                  <div className={`relative w-7 h-4 rounded-full transition-all ${slEnabled ? 'bg-danger' : 'bg-border2'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${slEnabled ? 'translate-x-3' : ''}`} />
                  </div>
                  Stop Loss
                </button>
                <TipIcon text="Auto-close if price moves against you by this % from entry." />
              </div>
              {slEnabled ? (
                <>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-text3">Trigger</span>
                    <span className="font-bold text-danger font-mono">{slPct}% · ${slPrice ? fmtPrice(slPrice) : '—'}</span>
                  </div>
                  <div className="relative h-4 flex items-center">
                    <div className="absolute inset-x-0 h-1 rounded-full bg-border2" />
                    <div className="absolute left-0 h-1 rounded-full bg-danger"
                      style={{ width: `${((slPct - 0.5) / 49.5) * 100}%` }} />
                    <input type="range" value={slPct} min={0.5} max={50} step={0.5}
                      onChange={e => setSlPct(Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-4" />
                    <div className="absolute w-3 h-3 rounded-full bg-danger border-2 border-white shadow pointer-events-none"
                      style={{ left: `calc(${((slPct - 0.5) / 49.5) * 100}% - 6px)` }} />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-text3">0.5%</span>
                    <span className="text-[9px] text-text3">50%</span>
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-text3">Off</div>
              )}
            </div>

            {/* Take Profit */}
            <div className={`border rounded-xl p-3 transition-all ${tpEnabled ? 'border-success/40 bg-success/5' : 'border-border1'}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button onClick={() => setTpEnabled(v => !v)}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${tpEnabled ? 'text-success' : 'text-text3'}`}>
                  <div className={`relative w-7 h-4 rounded-full transition-all ${tpEnabled ? 'bg-success' : 'bg-border2'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${tpEnabled ? 'translate-x-3' : ''}`} />
                  </div>
                  Take Profit
                </button>
                <TipIcon text="Auto-close when price moves in your favor by this % from entry." />
              </div>
              {tpEnabled ? (
                <>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-text3">Target</span>
                    <span className="font-bold text-success font-mono">{tpPct}% · ${tpPrice ? fmtPrice(tpPrice) : '—'}</span>
                  </div>
                  <div className="relative h-4 flex items-center">
                    <div className="absolute inset-x-0 h-1 rounded-full bg-border2" />
                    <div className="absolute left-0 h-1 rounded-full bg-success"
                      style={{ width: `${((tpPct - 1) / 99) * 100}%` }} />
                    <input type="range" value={tpPct} min={1} max={100} step={0.5}
                      onChange={e => setTpPct(Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-4" />
                    <div className="absolute w-3 h-3 rounded-full bg-success border-2 border-white shadow pointer-events-none"
                      style={{ left: `calc(${((tpPct - 1) / 99) * 100}% - 6px)` }} />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-text3">1%</span>
                    <span className="text-[9px] text-text3">100%</span>
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-text3">Off</div>
              )}
            </div>
          </div>

          {/* Price drift warning — only show if very large drift */}
          {entryPrice > 0 && traderEntry > 0 && (() => {
            const driftPct = Math.abs((markPrice - traderEntry) / traderEntry * 100);
            if (driftPct < 15) return null;
            return (
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border bg-warn/8 border-warn/30 text-warn text-[11px] leading-relaxed">
                <span className="text-[14px] shrink-0">⚠️</span>
                <div>
                  <strong>Price moved {driftPct.toFixed(1)}% since trader entry.</strong> Your order will execute at the current mark price, not the trader&apos;s entry price. Verify the trade still makes sense before copying.
                </div>
              </div>
            );
          })()}

          {/* CTA */}
          <button onClick={handleConfirm} disabled={placing || amount <= 0}
            className={`w-full py-3 rounded-xl font-bold text-[13px] transition-all flex items-center justify-center gap-2 ${
              isLong
                ? 'bg-success text-white hover:bg-success/90 disabled:bg-success/40'
                : 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40'
            } disabled:cursor-not-allowed`}>
            {placing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Placing Order...
              </>
            ) : (
              `Copy ${label} · $${amount} · ${leverage}×${slEnabled ? ` · SL ${slPct}%` : ''}${tpEnabled ? ` · TP ${tpPct}%` : ''}`
            )}
          </button>

          <p className="text-[10px] text-text3 text-center leading-relaxed">
            Builder code <span className="font-mono text-accent">PACIFICALENS</span> · No extra approval needed
          </p>
        </div>
      </div>
    </div>
  );
}
