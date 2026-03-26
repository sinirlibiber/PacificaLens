'use client';

import { useState, useEffect, useCallback } from 'react';

export type OrderStatus = 'pending' | 'success' | 'failed' | 'cancelled';

export interface OrderLogEntry {
  id: string;
  timestamp: number;
  wallet: string;
  symbol: string;
  side: 'bid' | 'ask';
  amount: string;
  price: string;
  orderType: 'limit' | 'market';
  status: OrderStatus;
  orderId?: string;
  error?: string;
  source: 'manual' | 'copy' | 'auto-copy';
  traderAddress?: string; // if copy trade
}

const LS_KEY = 'pacificalens_order_log_v1';
const MAX_ENTRIES = 200;

function load(): OrderLogEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function save(entries: OrderLogEntry[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {}
}

export function useOrderLog(wallet: string | null) {
  const [entries, setEntries] = useState<OrderLogEntry[]>([]);

  useEffect(() => {
    setEntries(load().filter(e => !wallet || e.wallet === wallet));
  }, [wallet]);

  const addEntry = useCallback((entry: Omit<OrderLogEntry, 'id' | 'timestamp' | 'wallet'> & { wallet?: string }) => {
    const full: OrderLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      wallet: entry.wallet || wallet || '',
    };
    setEntries(prev => {
      const next = [full, ...prev];
      save(load().filter(e => e.id !== full.id).concat(full).sort((a, b) => b.timestamp - a.timestamp));
      return next;
    });
    return full.id;
  }, [wallet]);

  const updateEntry = useCallback((id: string, patch: Partial<OrderLogEntry>) => {
    setEntries(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...patch } : e);
      const all = load().map(e => e.id === id ? { ...e, ...patch } : e);
      save(all);
      return next;
    });
  }, []);

  const clearLog = useCallback(() => {
    const all = load().filter(e => e.wallet !== wallet);
    save(all);
    setEntries([]);
  }, [wallet]);

  const stats = {
    total: entries.length,
    success: entries.filter(e => e.status === 'success').length,
    failed: entries.filter(e => e.status === 'failed').length,
    pending: entries.filter(e => e.status === 'pending').length,
  };

  return { entries, addEntry, updateEntry, clearLog, stats };
}

// ─── Copy Performance Stats per trader ───────────────────────────────────────

export interface TraderPerformance {
  traderAddress: string;
  totalOrders: number;
  successOrders: number;
  winRate: number;  // %
  // Note: PnL is not tracked in the order log — check trade history for realized PnL
}

export function getCopyPerformance(entries: OrderLogEntry[]): TraderPerformance[] {
  const map = new Map<string, TraderPerformance>();
  entries
    .filter(e => e.source === 'copy' || e.source === 'auto-copy')
    .filter(e => e.traderAddress)
    .forEach(e => {
      const addr = e.traderAddress!;
      if (!map.has(addr)) {
        map.set(addr, { traderAddress: addr, totalOrders: 0, successOrders: 0, winRate: 0 });
      }
      const p = map.get(addr)!;
      p.totalOrders++;
      if (e.status === 'success') p.successOrders++;
      p.winRate = p.totalOrders > 0 ? (p.successOrders / p.totalOrders) * 100 : 0;
    });
  return Array.from(map.values()).sort((a, b) => b.totalOrders - a.totalOrders);
}
