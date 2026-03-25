'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TraderScore } from '@/lib/traderScore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreCache {
  scores: Record<string, TraderScore>;
  computedAt: number;
  totalTraders: number;
}

const LS_KEY = 'pacificalens_trader_scores_v2';
const STALE_THRESHOLD = 23 * 60 * 60 * 1000; // 23 hours — matches daily cron

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTraderScore() {
  const [scores, setScores]         = useState<Record<string, TraderScore>>({});
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState<number | null>(null);
  const fetchedRef                  = useRef(false);

  // ── Load from localStorage on mount (instant, no flicker) ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const cached: ScoreCache = JSON.parse(raw);
        setScores(cached.scores);
        setComputedAt(cached.computedAt);
      }
    } catch { /* ignore corrupt cache */ }
  }, []);

  // ── Fetch from API ──────────────────────────────────────────
  const fetchScores = useCallback(async (force = false) => {
    if (loading) return;

    // Check if localStorage cache is fresh enough
    if (!force) {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const cached: ScoreCache = JSON.parse(raw);
          const age = Date.now() - cached.computedAt;
          if (age < STALE_THRESHOLD) return; // still fresh, skip fetch
        }
      } catch { /* ignore */ }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trader-score', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      const cache: ScoreCache = {
        scores: data.scores,
        computedAt: data.computedAt,
        totalTraders: data.totalTraders,
      };

      setScores(data.scores);
      setComputedAt(data.computedAt);
      localStorage.setItem(LS_KEY, JSON.stringify(cache));
    } catch (e) {
      setError(String(e));
      // Keep showing stale scores on error — don't clear them
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // ── Fetch on mount (respects freshness check) ───────────────
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchScores();
  }, [fetchScores]);

  // ── Re-fetch when tab becomes visible after long absence ────
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchScores(); // freshness check inside, won't spam
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchScores]);

  // ── Helper to get a single trader's score ───────────────────
  const getScore = useCallback(
    (account: string): TraderScore | null => scores[account] ?? null,
    [scores]
  );

  return {
    scores,
    loading,
    error,
    computedAt,
    getScore,
    refreshScores: () => fetchScores(true),
  };
}
