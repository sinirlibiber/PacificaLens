// ─── Trader Score System v2 ────────────────────────────────────────────────────
// Enhanced scoring: Drawdown penalty, EPR (Exposure Profit Ratio), Win Rate, OI Risk,
// Momentum/streak — all blended into a 0–100 composite score.
// Tier system: S / A / B / C  (D tier removed)
// Trader Style: Scalper | Swing Trader | Whale | High Risk | Balanced
// Refreshed every 23 hours via Vercel cron + unstable_cache.

import { LeaderboardEntry } from '@/hooks/useCopyTrading';

export type ScoreTier = 'S' | 'A' | 'B' | 'C';

export type TraderStyle = 'Scalper' | 'Swing Trader' | 'Whale' | 'High Risk' | 'Balanced';

export interface TraderScoreBreakdown {
  pnl: number;         // 0–30  (percentile-ranked 30d PnL)
  consistency: number; // 0–20  (7d/30d momentum alignment)
  epr: number;         // 0–20  (Exposure Profit Ratio: PnL relative to exposure/drawdown)
  winRate: number;     // 0–15  (long-term PnL/volume efficiency proxy)
  drawdown: number;    // 0–10  (drawdown control — lower drop = higher score)
  oiRisk: number;      // 0–5   (OI/equity ratio — high OI = lower score)
}

export interface TraderScore {
  score: number;             // 0–100
  tier: ScoreTier;
  breakdown: TraderScoreBreakdown;
  style: TraderStyle;
  lastUpdated: number;       // unix ms
}

// ─── Percentile helpers ───────────────────────────────────────────────────────

function percentileScore(value: number, values: number[], weight: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter(v => v <= value).length;
  return (rank / sorted.length) * weight;
}

// ─── Trader Style classifier ──────────────────────────────────────────────────

export function classifyTraderStyle(entry: LeaderboardEntry): TraderStyle {
  const equity = entry.equity_current || 1;
  const oiRatio = entry.oi_current / equity;
  const volume7d = entry.volume_7d || 0;
  const volume30d = entry.volume_30d || 1;

  // High Risk: OI/equity > 5 OR negative all-time PnL with high volume
  if (oiRatio > 5 || (entry.pnl_all < 0 && volume30d > 100_000)) {
    return 'High Risk';
  }

  // Whale: very high volume or equity
  if (volume30d > 5_000_000 || equity > 500_000) {
    return 'Whale';
  }

  // Scalper: most activity compressed into recent 7d (high churn)
  const recentActivity = volume30d > 0 ? volume7d / volume30d : 0;
  if (recentActivity > 0.55 && volume7d > 10_000) {
    return 'Scalper';
  }

  // Swing Trader: moderate volume, consistent across 30d, positive PnL
  if (entry.pnl_30d > 0 && recentActivity >= 0.15 && recentActivity <= 0.55) {
    return 'Swing Trader';
  }

  return 'Balanced';
}

// ─── Main calculation ─────────────────────────────────────────────────────────

export function calculateScores(entries: LeaderboardEntry[]): Map<string, TraderScore> {
  const now = Date.now();
  const result = new Map<string, TraderScore>();

  if (entries.length === 0) return result;

  const pnl30dValues = entries.map(e => e.pnl_30d);

  for (const entry of entries) {

    // ── 1. PnL score (0–30) ───────────────────────────────────
    let pnlScore = percentileScore(entry.pnl_30d, pnl30dValues, 30);
    if (entry.pnl_30d < 0) pnlScore = Math.min(pnlScore, 6);

    // ── 2. Consistency / Momentum (0–20) ─────────────────────
    let consistencyScore = 0;
    if (entry.pnl_30d > 0 && entry.pnl_7d > 0) {
      const expectedWeekly = entry.pnl_30d / 4;
      const ratio = entry.pnl_7d / expectedWeekly;
      if (ratio >= 0.5 && ratio <= 2.0) {
        consistencyScore = 20 * (1 - Math.abs(ratio - 1) / 1.5);
      } else if (ratio > 0 && ratio < 0.5) {
        consistencyScore = 20 * (ratio / 0.5) * 0.4;
      } else if (ratio > 2.0) {
        consistencyScore = 8; // lucky spike
      } else {
        consistencyScore = 3;
      }
    } else if (entry.pnl_30d > 0 && entry.pnl_7d <= 0) {
      consistencyScore = 3; // weakening momentum
    } else if (entry.pnl_30d < 0 && entry.pnl_7d > 0) {
      consistencyScore = 6; // recovering
    }
    consistencyScore = Math.max(0, Math.min(20, consistencyScore));

    // ── 3. EPR — Exposure Profit Ratio (0–20) ─────────────────
    // PnL efficiency relative to OI exposure (or volume as fallback)
    let eprScore = 0;
    const exposure = entry.oi_current > 0 ? entry.oi_current : entry.volume_30d;
    if (exposure > 0 && entry.pnl_30d > 0) {
      const eprProxy = entry.pnl_30d / exposure;
      if (eprProxy >= 0.10)       eprScore = 20;
      else if (eprProxy >= 0.05)  eprScore = 16;
      else if (eprProxy >= 0.02)  eprScore = 12;
      else if (eprProxy >= 0.01)  eprScore = 8;
      else if (eprProxy > 0)      eprScore = 4;
    }
    eprScore = Math.max(0, Math.min(20, eprScore));

    // ── 4. Win-Rate proxy (0–15) ──────────────────────────────
    // Long-term PnL / volume_all as profit factor proxy
    let winRateScore = 0;
    if (entry.volume_all > 0) {
      const eff = entry.pnl_all / entry.volume_all;
      if (eff >= 0.05)       winRateScore = 15;
      else if (eff >= 0.02)  winRateScore = 12;
      else if (eff >= 0.01)  winRateScore = 9;
      else if (eff >= 0.005) winRateScore = 6;
      else if (eff >= 0)     winRateScore = 3;
    }
    winRateScore = Math.max(0, Math.min(15, winRateScore));

    // ── 5. Drawdown control score (0–10) ──────────────────────
    // Measures how well the trader controlled recent losses vs overall gains
    let drawdownScore = 5;
    if (entry.pnl_30d > 0) {
      if (entry.pnl_7d >= 0) {
        drawdownScore = 10; // no drawdown
      } else {
        const dropRatio = Math.abs(entry.pnl_7d) / entry.pnl_30d;
        if (dropRatio < 0.1)       drawdownScore = 9;
        else if (dropRatio < 0.25) drawdownScore = 7;
        else if (dropRatio < 0.5)  drawdownScore = 5;
        else if (dropRatio < 1.0)  drawdownScore = 3;
        else                       drawdownScore = 1;
      }
    } else if (entry.pnl_30d < 0) {
      drawdownScore = 1;
    }
    drawdownScore = Math.max(0, Math.min(10, drawdownScore));

    // ── 6. OI / Equity Risk (0–5) ─────────────────────────────
    // High OI/equity = overexposed = penalty
    let oiRiskScore = 5;
    if (entry.equity_current > 0 && entry.oi_current > 0) {
      const oiRatio = entry.oi_current / entry.equity_current;
      if (oiRatio <= 1)       oiRiskScore = 5;
      else if (oiRatio <= 2)  oiRiskScore = 4;
      else if (oiRatio <= 5)  oiRiskScore = 3;
      else if (oiRatio <= 10) oiRiskScore = 1;
      else                    oiRiskScore = 0;
    }
    oiRiskScore = Math.max(0, Math.min(5, oiRiskScore));

    // ── Composite ─────────────────────────────────────────────
    const raw = pnlScore + consistencyScore + eprScore + winRateScore + drawdownScore + oiRiskScore;
    const clampedScore = Math.max(0, Math.min(100, Math.round(raw)));

    result.set(entry.account, {
      score: clampedScore,
      tier: scoreToTier(clampedScore),
      style: classifyTraderStyle(entry),
      breakdown: {
        pnl:         Math.round(pnlScore),
        consistency: Math.round(consistencyScore),
        epr:         Math.round(eprScore),
        winRate:     Math.round(winRateScore),
        drawdown:    Math.round(drawdownScore),
        oiRisk:      Math.round(oiRiskScore),
      },
      lastUpdated: now,
    });
  }

  return result;
}

// ─── Tier thresholds — S/A/B/C (no D) ────────────────────────────────────────
// S ≥ 80 → top ~5%   | A ≥ 62 → top ~20%
// B ≥ 42 → top ~45%  | C < 42 → bottom ~55%

export function scoreToTier(score: number): ScoreTier {
  if (score >= 80) return 'S';
  if (score >= 62) return 'A';
  if (score >= 42) return 'B';
  return 'C';
}

// ─── Colors ───────────────────────────────────────────────────────────────────

export const TIER_COLORS: Record<ScoreTier, { bg: string; text: string; border: string }> = {
  S: { bg: 'bg-[#fbbf24]/20', text: 'text-[#d97706]', border: 'border-[#fbbf24]' },
  A: { bg: 'bg-success/10',   text: 'text-success',   border: 'border-success/30' },
  B: { bg: 'bg-accent/10',    text: 'text-accent',    border: 'border-accent/30' },
  C: { bg: 'bg-warn/10',      text: 'text-warn',      border: 'border-warn/30' },
};

// ─── Style metadata ───────────────────────────────────────────────────────────

export const STYLE_META: Record<TraderStyle, { icon: string; color: string; desc: string }> = {
  'Scalper':      { icon: '⚡', color: 'text-[#f472b6]', desc: 'Very short-term trades chasing small profits' },
  'Swing Trader': { icon: '📈', color: 'text-accent',     desc: 'Follows daily/weekly trends' },
  'Whale':        { icon: '🐋', color: 'text-[#60a5fa]',  desc: 'High-volume, market-moving positions' },
  'High Risk':    { icon: '🔥', color: 'text-danger',     desc: 'No stop-loss / high volatility' },
  'Balanced':     { icon: '⚖️', color: 'text-text2',      desc: 'Balanced risk/reward profile' },
};
