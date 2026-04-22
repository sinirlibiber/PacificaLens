'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  account: string;
  pnl_7d: number;
  pnl_30d: number;
  pnl_all: number;
  volume_7d: number;
  volume_30d: number;
  volume_all: number;
  equity_current: number;
  oi_current: number;
  // rank is positional from sorted array
}

export interface TraderTrade {
  id?: string;
  symbol: string;
  side: string;      // open_long, open_short, close_long, close_short
  price: string;
  amount: string;
  fee?: string;
  realized_pnl?: string;
  created_at: string | number;
  cause?: string;
}

export type SortField =
  | 'pnl_7d' | 'pnl_30d' | 'pnl_all'
  | 'volume_7d' | 'volume_30d' | 'volume_all'
  | 'equity_current' | 'oi_current' | 'score' | 'watching' | 'style';

export type SortDir = 'desc' | 'asc';

export interface AutoCopySettings {
  // What to copy
  copyOpen: boolean;         // copy when trader opens a position
  copyClose: boolean;        // copy when trader closes a position

  // Position sizing
  sizeMode: 'fixed' | 'proportional'; // fixed USDC or % of equity
  copyAmount: number;        // USDC per trade (fixed mode)
  copyPercent: number;       // % of my equity (proportional mode)
  copyLeverage: number;      // leverage to use

  // Risk controls
  maxOpenPositions: number;  // 0 = unlimited
  stopLossEnabled: boolean;
  stopLossPercent: number;   // % from entry
  takeProfitEnabled: boolean;
  takeProfitPercent: number; // % from entry

  // Smart polling
  cooldownMinutes: number;   // min minutes between same-symbol copies
  maxDailyLoss: number;      // 0 = unlimited, stops auto-copy if daily loss exceeds
}

export interface FavoriteTrader {
  account: string;
  addedAt: number;
  copyAmount: number;
  copyLeverage: number;
  // New settings
  settings: AutoCopySettings;
}

export const DEFAULT_SETTINGS: AutoCopySettings = {
  copyOpen: true,
  copyClose: false,
  sizeMode: 'fixed',
  copyAmount: 100,
  copyPercent: 5,
  copyLeverage: 5,
  maxOpenPositions: 0,
  stopLossEnabled: false,
  stopLossPercent: 5,
  takeProfitEnabled: false,
  takeProfitPercent: 10,
  cooldownMinutes: 0,
  maxDailyLoss: 0,
};

const LS_FAVORITES_KEY = 'pacificalens_copy_favorites_v1';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useCopyTrading() {

  // Leaderboard state
  const [leaderboard, setLeaderboard]   = useState<LeaderboardEntry[]>([]);
  const [lbLoading, setLbLoading]       = useState(false);
  const [lbError, setLbError]           = useState<string | null>(null);
  const [sortField, setSortField]       = useState<SortField>('pnl_30d');
  const [sortDir, setSortDir]           = useState<SortDir>('desc');
  const [searchQuery, setSearchQuery]   = useState('');
  const [page, setPage]                 = useState(0);
  const PAGE_SIZE = 50;

  // Favorites state
  const [favorites, setFavorites]       = useState<FavoriteTrader[]>([]);

  // Trader trades state: account → trades[]
  const [traderTrades, setTraderTrades] = useState<Record<string, TraderTrade[]>>({});
  const [tradesLoading, setTradesLoading] = useState<Record<string, boolean>>({});

  // ── Load favorites from localStorage ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_FAVORITES_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // ── Persist favorites ──
  useEffect(() => {
    localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  // ─── Leaderboard fetch ────────────────────────────────────────────────────

  const fetchLeaderboard = useCallback(async () => {
    setLbLoading(true);
    setLbError(null);
    try {
      // Route through Next.js proxy to avoid CORS
      // Try all known Pacifica leaderboard endpoint variants
      const res = await fetch('/api/proxy?path=' + encodeURIComponent('leaderboard?limit=25000'), { cache: 'no-store' });
      const json = await res.json();

      let entries: LeaderboardEntry[] = [];

      // Pacifica returns { success, data: [...] } or bare array
      const rawArr: Record<string, unknown>[] =
        json.success && Array.isArray(json.data)  ? json.data :
        Array.isArray(json)                        ? json :
        json.data && Array.isArray(json.data)      ? json.data :
        null;

      if (rawArr) {
        const mapEntry = (d: Record<string, unknown>): LeaderboardEntry => ({
          account:        (() => {
            // API may return shortened address in 'address' and full in 'account'
            // Always prefer the longest (full) address — truncated ones contain '...'
            const candidates = [d.address, d.account, d.wallet]
              .map(v => String(v || ''))
              .filter(v => v.length > 0);
            const full = candidates.find(v => !v.includes('...'));
            return (full || candidates[0] || ''); // Solana addresses are case-sensitive — do NOT toLowerCase
          })(),
          pnl_7d:         Number(d.pnl_7d ?? 0),
          pnl_30d:        Number(d.pnl_30d ?? 0),
          pnl_all:        Number(d.pnl_all_time ?? d.pnl_all ?? 0),
          volume_7d:      Number(d.volume_7d ?? 0),
          volume_30d:     Number(d.volume_30d ?? 0),
          volume_all:     Number(d.volume_all_time ?? d.volume_all ?? d.volume ?? 0),
          equity_current: Number(d.equity_current ?? 0),
          oi_current:     Number(d.oi_current ?? 0),
        });
        entries = rawArr.map(mapEntry).filter(e => e.account.length > 0);
      } else {
        // Log the actual response shape so we can debug
        console.error('[PacificaLens] Leaderboard unexpected response:', JSON.stringify(json).slice(0, 300));
        setLbError('Leaderboard API returned an unexpected format. Check browser console for details.');
      }

      // Debug: log first raw entry to help identify correct field names
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        console.log('[PacificaLens] Leaderboard raw sample entry:', json.data[0]);
        console.log('[PacificaLens] Leaderboard total entries:', json.data.length);
      }
      setLeaderboard(entries);
    } catch (e) {
      setLbError(String(e));
    } finally {
      setLbLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  // ─── Sorting / filtering helpers ─────────────────────────────────────────

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(0);
  }

  const filteredSorted = (() => {
    let list = leaderboard;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(e => e.account.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      if (sortField === 'score') return 0; // score sort handled in component
      if (sortField === 'watching') return 0; // watching sort handled in component
      if (sortField === 'style') return 0; // style sort handled in component
      const va = a[sortField as Exclude<SortField, 'score' | 'watching' | 'style'>];
      const vb = b[sortField as Exclude<SortField, 'score' | 'watching' | 'style'>];
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return list;
  })();

  const totalPages  = Math.ceil(filteredSorted.length / PAGE_SIZE);
  const pagedList   = filteredSorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const globalStart = page * PAGE_SIZE; // for rank display

  // ─── Favorites management ─────────────────────────────────────────────────

  function isFavorite(account: string) {
    return favorites.some(f => f.account === account);
  }

  function toggleFavorite(account: string) {
    setFavorites(prev => {
      if (prev.some(f => f.account === account)) {
        return prev.filter(f => f.account !== account);
      }
      return [...prev, {
        account,
        addedAt: Date.now(),
        copyAmount: 100,
        copyLeverage: 5,
        settings: { ...DEFAULT_SETTINGS },
      }];
    });
  }

  function updateFavorite(account: string, patch: Partial<Omit<FavoriteTrader, 'account' | 'addedAt'>>) {
    setFavorites(prev => prev.map(f => f.account === account ? { ...f, ...patch } : f));
  }

  function removeFavorite(account: string) {
    setFavorites(prev => prev.filter(f => f.account !== account));
  }

  // ─── Trader trades fetch ──────────────────────────────────────────────────

  const fetchTraderTrades = useCallback(async (account: string, silent = false) => {
    if (!silent) setTradesLoading(prev => ({ ...prev, [account]: true }));
    try {
      // Try account/trade_history endpoint first
      // Use confirmed endpoint from docs: trades/history
      const res = await fetch(
        `/api/proxy?path=${encodeURIComponent(`trades/history?account=${account}&limit=20`)}`,
        { cache: 'no-store' }
      );
      const json = await res.json();

      let trades: TraderTrade[] = [];

      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        trades = json.data.map((t: Record<string, unknown>) => ({
          id:           String(t.id || ''),
          symbol:       String(t.symbol || ''),
          side:         String(t.side || ''),
          price:        String(t.price || '0'),
          amount:       String(t.amount || '0'),
          fee:          String(t.fee || '0'),
          realized_pnl: String(t.realized_pnl || '0'),
          created_at:   t.created_at as string | number,
          cause:        String(t.cause || 'normal'),
        }));
      } else {
        // Fallback: try trades?wallet= endpoint
        const res2 = await fetch(
          `/api/proxy?path=${encodeURIComponent(`trades?wallet=${account}&limit=20`)}`,
          { cache: 'no-store' }
        );
        const json2 = await res2.json();
        if (json2.success && Array.isArray(json2.data)) {
          trades = json2.data.map((t: Record<string, unknown>) => ({
            id:           String(t.id || ''),
            symbol:       String(t.symbol || ''),
            side:         String(t.side || t.event_type || ''),
            price:        String(t.price || '0'),
            amount:       String(t.amount || '0'),
            created_at:   t.created_at as string | number,
            cause:        String(t.cause || 'normal'),
          }));
        }
      }

      setTraderTrades(prev => ({ ...prev, [account]: trades }));
      return trades;
    } catch {
      return [];
    } finally {
      if (!silent) setTradesLoading(prev => ({ ...prev, [account]: false }));
    }
  }, []);

  // Fetch trades for all favorites on mount + when favorites change
  useEffect(() => {
    favorites.forEach(f => {
      if (!traderTrades[f.account]) {
        fetchTraderTrades(f.account);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites.map(f => f.account).join(',')]);

  // ─── Auto-copy polling ────────────────────────────────────────────────────




  // ─── Return ───────────────────────────────────────────────────────────────

  return {
    // Leaderboard
    leaderboard,
    lbLoading,
    lbError,
    fetchLeaderboard,
    sortField,
    sortDir,
    toggleSort,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    totalPages,
    pagedList,
    globalStart,
    PAGE_SIZE,
    filteredTotal: filteredSorted.length,

    // Favorites
    favorites,
    isFavorite,
    toggleFavorite,
    updateFavorite,
    removeFavorite,

    // Trader trades
    traderTrades,
    tradesLoading,
    fetchTraderTrades,
  };
}
