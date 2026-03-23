// ─── Trader Score System ──────────────────────────────────────────────────────
// Scores are calculated from leaderboard data only (no extra API calls).
// Refreshed every 12 hours via Vercel cron + unstable_cache.

import { LeaderboardEntry } from '@/hooks/useCopyTrading';

export type ScoreTier = 'S' | 'A' | 'B' | 'C' | 'D';

export interface TraderScoreBreakdown {
  pnl: number;         // 0–40  (weighted most heavily)
  consistency: number; // 0–25  (7d/30d ratio — sustained performance)
  volume: number;      // 0–20  (activity level)
  risk: number;        // 0–15  (PnL/volume efficiency)
}

export interface TraderScore {
  score: number;             // 0–100
  tier: ScoreTier;
  breakdown: TraderScoreBreakdown;
  lastUpdated: number;       // unix ms
}

// ─── Percentile helpers ───────────────────────────────────────────────────────

function percentileScore(value: number, values: number[], weight: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter(v => v <= value).length;
  return (rank / sorted.length) * weight;
}

// ─── Main calculation ─────────────────────────────────────────────────────────

export function calculateScores(entries: LeaderboardEntry[]): Map<string, TraderScore> {
  const now = Date.now();
  const result = new Map<string, TraderScore>();

  if (entries.length === 0) return result;

  // Pre-compute arrays for percentile ranking
  const pnl30dValues    = entries.map(e => e.pnl_30d);
  const volume30dValues = entries.map(e => e.volume_30d);

  for (const entry of entries) {
    // ── PnL score (0–40) ─────────────────────────────────────────
    // Percentile rank among all traders, capped at 40 pts
    // Negative PnL traders get at most 8 pts (bottom 20%)
    let pnlScore = percentileScore(entry.pnl_30d, pnl30dValues, 40);
    if (entry.pnl_30d < 0) pnlScore = Math.min(pnlScore, 8);

    // ── Consistency score (0–25) ──────────────────────────────────
    // How well does 7d performance track 30d performance?
    // If pnl_30d > 0 and pnl_7d is also positive and proportional → high score
    let consistencyScore = 0;
    if (entry.pnl_30d > 0 && entry.pnl_7d > 0) {
      const expectedWeekly = entry.pnl_30d / 4;
      const ratio = entry.pnl_7d / expectedWeekly;
      // ratio ~1 = perfectly consistent, >2 = lucky spike, <0.5 = slowing down
      if (ratio >= 0.5 && ratio <= 2.0) {
        consistencyScore = 25 * (1 - Math.abs(ratio - 1) / 1.5);
      } else if (ratio > 0 && ratio < 0.5) {
        consistencyScore = 25 * (ratio / 0.5) * 0.5; // partial credit
      } else {
        consistencyScore = 5; // some activity but inconsistent
      }
    } else if (entry.pnl_30d > 0 && entry.pnl_7d <= 0) {
      consistencyScore = 5; // was profitable but recent week is bad
    }
    consistencyScore = Math.max(0, Math.min(25, consistencyScore));

    // ── Volume score (0–20) ───────────────────────────────────────
    // Active traders score higher — percentile rank
    const volumeScore = percentileScore(entry.volume_30d, volume30dValues, 20);

    // ── Risk/efficiency score (0–15) ──────────────────────────────
    // PnL relative to volume traded (higher = more efficient)
    let riskScore = 0;
    if (entry.volume_30d > 0) {
      const efficiency = entry.pnl_30d / entry.volume_30d; // e.g. 0.02 = 2% return on volume
      if (efficiency >= 0.05) riskScore = 15;
      else if (efficiency >= 0.02) riskScore = 12;
      else if (efficiency >= 0.01) riskScore = 9;
      else if (efficiency >= 0.005) riskScore = 6;
      else if (efficiency >= 0) riskScore = 3;
      else riskScore = 0; // negative efficiency
    }

    const score = Math.round(pnlScore + consistencyScore + volumeScore + riskScore);
    const clampedScore = Math.max(0, Math.min(100, score));

    result.set(entry.account, {
      score: clampedScore,
      tier: scoreToTier(clampedScore),
      breakdown: {
        pnl: Math.round(pnlScore),
        consistency: Math.round(consistencyScore),
        volume: Math.round(volumeScore),
        risk: Math.round(riskScore),
      },
      lastUpdated: now,
    });
  }

  return result;
}

export function scoreToTier(score: number): ScoreTier {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 50) return 'B';
  if (score >= 30) return 'C';
  return 'D';
}

export const TIER_COLORS: Record<ScoreTier, { bg: string; text: string; border: string }> = {
  S: { bg: 'bg-[#fbbf24]/20', text: 'text-[#d97706]', border: 'border-[#fbbf24]' },
  A: { bg: 'bg-success/10',   text: 'text-success',   border: 'border-success/30' },
  B: { bg: 'bg-accent/10',    text: 'text-accent',    border: 'border-accent/30' },
  C: { bg: 'bg-warn/10',      text: 'text-warn',      border: 'border-warn/30' },
  D: { bg: 'bg-danger/10',    text: 'text-danger',    border: 'border-danger/30' },
};
