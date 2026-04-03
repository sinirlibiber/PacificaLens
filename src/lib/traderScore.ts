// ─── Trader Score System v3 ────────────────────────────────────────────────────
// Key fixes:
//   - Minimum activity gate: volume_30d = 0 → score 0, tier C
//   - All-time track record component (0-10)
//   - Capital efficiency: pnl_30d / equity (0-10)
//   - Dynamic tier thresholds (percentile-based)
//   - Reduced PnL weight (30→20), added new components

import { LeaderboardEntry } from '@/hooks/useCopyTrading';

export type ScoreTier = 'S' | 'A' | 'B' | 'C';
export type TraderStyle = 'Scalper' | 'Swing Trader' | 'Whale' | 'High Risk' | 'Balanced';

export interface TraderScoreBreakdown {
  pnl:         number; // 0–20  (percentile-ranked 30d PnL)
  consistency: number; // 0–20  (7d/30d momentum alignment)
  epr:         number; // 0–15  (Exposure Profit Ratio)
  winRate:     number; // 0–15  (long-term PnL/volume efficiency)
  drawdown:    number; // 0–10  (drawdown control)
  oiRisk:      number; // 0–5   (OI/equity ratio)
  trackRecord: number; // 0–10  (all-time PnL consistency)
  capEfficiency:number;// 0–5   (pnl_30d / equity)
}

export interface TraderScore {
  score:       number;
  tier:        ScoreTier;
  breakdown:   TraderScoreBreakdown;
  style:       TraderStyle;
  lastUpdated: number;
}

// ─── Percentile helper ────────────────────────────────────────────────────────
function percentileScore(value: number, values: number[], weight: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter(v => v <= value).length;
  return (rank / sorted.length) * weight;
}

// ─── Trader Style classifier ──────────────────────────────────────────────────
export function classifyTraderStyle(entry: LeaderboardEntry): TraderStyle {
  const equity    = entry.equity_current || 1;
  const oiRatio   = entry.oi_current / equity;
  const vol7d     = entry.volume_7d  || 0;
  const vol30d    = entry.volume_30d || 1;
  const recentAct = vol30d > 0 ? vol7d / vol30d : 0;

  if (oiRatio > 5 || (entry.pnl_all < 0 && vol30d > 100_000))
    return 'High Risk';
  if (vol30d > 5_000_000 || equity > 500_000)
    return 'Whale';
  if (recentAct > 0.55 && vol7d > 10_000)
    return 'Scalper';
  if (entry.pnl_30d > 0 && recentAct >= 0.15 && recentAct <= 0.55)
    return 'Swing Trader';
  return 'Balanced';
}

// ─── Main calculation ─────────────────────────────────────────────────────────
export function calculateScores(entries: LeaderboardEntry[]): Map<string, TraderScore> {
  const now = Date.now();
  const result = new Map<string, TraderScore>();
  if (entries.length === 0) return result;

  // Only score ACTIVE traders (volume_30d > 0) for percentile ranking
  const activeEntries = entries.filter(e => e.volume_30d > 0);
  const pnl30dValues  = activeEntries.map(e => e.pnl_30d);

  for (const entry of entries) {

    // ── GATE: no activity in 30d → score 0, tier C ────────────────
    if (entry.volume_30d === 0) {
      result.set(entry.account, {
        score: 0, tier: 'C',
        style: classifyTraderStyle(entry),
        breakdown: { pnl:0, consistency:0, epr:0, winRate:0, drawdown:0, oiRisk:0, trackRecord:0, capEfficiency:0 },
        lastUpdated: now,
      });
      continue;
    }

    // ── 1. PnL score (0–20) ───────────────────────────────────────
    let pnlScore = percentileScore(entry.pnl_30d, pnl30dValues, 20);
    if (entry.pnl_30d < 0) pnlScore = Math.min(pnlScore, 4);

    // ── 2. Consistency / Momentum (0–20) ─────────────────────────
    let consistencyScore = 0;
    if (entry.pnl_30d > 0 && entry.pnl_7d > 0) {
      const expectedWeekly = entry.pnl_30d / 4;
      const ratio = entry.pnl_7d / expectedWeekly;
      if      (ratio >= 0.5 && ratio <= 2.0) consistencyScore = 20 * (1 - Math.abs(ratio - 1) / 1.5);
      else if (ratio > 0 && ratio < 0.5)     consistencyScore = 20 * (ratio / 0.5) * 0.4;
      else if (ratio > 2.0)                  consistencyScore = 8;
      else                                   consistencyScore = 3;
    } else if (entry.pnl_30d > 0 && entry.pnl_7d <= 0) {
      consistencyScore = 3;
    } else if (entry.pnl_30d < 0 && entry.pnl_7d > 0) {
      consistencyScore = 6;
    }
    consistencyScore = Math.max(0, Math.min(20, consistencyScore));

    // ── 3. EPR — Exposure Profit Ratio (0–15) ─────────────────────
    let eprScore = 0;
    const exposure = entry.oi_current > 0 ? entry.oi_current : entry.volume_30d;
    if (exposure > 0 && entry.pnl_30d > 0) {
      const epr = entry.pnl_30d / exposure;
      if      (epr >= 0.10) eprScore = 15;
      else if (epr >= 0.05) eprScore = 12;
      else if (epr >= 0.02) eprScore = 9;
      else if (epr >= 0.01) eprScore = 6;
      else if (epr > 0)     eprScore = 3;
    }
    eprScore = Math.max(0, Math.min(15, eprScore));

    // ── 4. Win-Rate proxy (0–15) ──────────────────────────────────
    let winRateScore = 0;
    if (entry.volume_all > 0) {
      const eff = entry.pnl_all / entry.volume_all;
      if      (eff >= 0.05)  winRateScore = 15;
      else if (eff >= 0.02)  winRateScore = 12;
      else if (eff >= 0.01)  winRateScore = 9;
      else if (eff >= 0.005) winRateScore = 6;
      else if (eff >= 0)     winRateScore = 3;
    }
    winRateScore = Math.max(0, Math.min(15, winRateScore));

    // ── 5. Drawdown control (0–10) ────────────────────────────────
    let drawdownScore = 5;
    if (entry.pnl_30d > 0) {
      if (entry.pnl_7d >= 0) {
        drawdownScore = 10;
      } else {
        const dropRatio = Math.abs(entry.pnl_7d) / entry.pnl_30d;
        if      (dropRatio < 0.10) drawdownScore = 9;
        else if (dropRatio < 0.25) drawdownScore = 7;
        else if (dropRatio < 0.50) drawdownScore = 5;
        else if (dropRatio < 1.00) drawdownScore = 3;
        else                       drawdownScore = 1;
      }
    } else if (entry.pnl_30d < 0) {
      drawdownScore = 1;
    }
    drawdownScore = Math.max(0, Math.min(10, drawdownScore));

    // ── 6. OI Risk (0–5) ──────────────────────────────────────────
    let oiRiskScore = 5;
    if (entry.equity_current > 0 && entry.oi_current > 0) {
      const r = entry.oi_current / entry.equity_current;
      if      (r <= 1)  oiRiskScore = 5;
      else if (r <= 2)  oiRiskScore = 4;
      else if (r <= 5)  oiRiskScore = 3;
      else if (r <= 10) oiRiskScore = 1;
      else              oiRiskScore = 0;
    }
    oiRiskScore = Math.max(0, Math.min(5, oiRiskScore));

    // ── 7. All-time track record (0–10) ───────────────────────────
    // Rewards traders who have been consistently profitable long-term
    let trackRecord = 0;
    if (entry.pnl_all > 0 && entry.volume_all > 0) {
      const ltEff = entry.pnl_all / entry.volume_all;
      // Also reward absolute size of all-time PnL
      if      (entry.pnl_all > 100_000) trackRecord = 10;
      else if (entry.pnl_all > 10_000)  trackRecord = 8;
      else if (entry.pnl_all > 1_000)   trackRecord = 6;
      else if (entry.pnl_all > 100)     trackRecord = 4;
      else if (entry.pnl_all > 0)       trackRecord = 2;
      // Bonus for high long-term efficiency
      if (ltEff >= 0.02) trackRecord = Math.min(10, trackRecord + 2);
    } else if (entry.pnl_all < 0) {
      trackRecord = 0;
    }
    trackRecord = Math.max(0, Math.min(10, trackRecord));

    // ── 8. Capital Efficiency (0–5) ───────────────────────────────
    // pnl_30d relative to equity — small account big gains = efficient
    let capEfficiency = 0;
    if (entry.equity_current > 0 && entry.pnl_30d > 0) {
      const ce = entry.pnl_30d / entry.equity_current;
      if      (ce >= 0.50) capEfficiency = 5;
      else if (ce >= 0.20) capEfficiency = 4;
      else if (ce >= 0.10) capEfficiency = 3;
      else if (ce >= 0.05) capEfficiency = 2;
      else if (ce > 0)     capEfficiency = 1;
    }
    capEfficiency = Math.max(0, Math.min(5, capEfficiency));

    // ── Composite (max 100) ───────────────────────────────────────
    // 20+20+15+15+10+5+10+5 = 100
    const raw = pnlScore + consistencyScore + eprScore + winRateScore +
                drawdownScore + oiRiskScore + trackRecord + capEfficiency;
    const score = Math.max(0, Math.min(100, Math.round(raw)));

    result.set(entry.account, {
      score,
      tier: '__PENDING__' as ScoreTier, // set after dynamic tiers below
      style: classifyTraderStyle(entry),
      breakdown: {
        pnl:          Math.round(pnlScore),
        consistency:  Math.round(consistencyScore),
        epr:          Math.round(eprScore),
        winRate:      Math.round(winRateScore),
        drawdown:     Math.round(drawdownScore),
        oiRisk:       Math.round(oiRiskScore),
        trackRecord:  Math.round(trackRecord),
        capEfficiency:Math.round(capEfficiency),
      },
      lastUpdated: now,
    });
  }

  // ── Dynamic tier thresholds (percentile-based) ───────────────────
  // Only active traders are ranked
  const activeScores = Array.from(result.values())
    .filter(v => v.score > 0)
    .map(v => v.score)
    .sort((a, b) => a - b);

  const total = activeScores.length;
  const pct = (p: number) => total > 0
    ? activeScores[Math.floor((p / 100) * total)] ?? 0
    : 0;

  // S = top 5%, A = top 20%, B = top 45%, C = rest
  const sThreshold = pct(95);
  const aThreshold = pct(80);
  const bThreshold = pct(55);

  for (const [account, ts] of Array.from(result.entries())) {
    if (ts.score === 0) { (ts as any).tier = 'C'; continue; }
    if (ts.score >= sThreshold && sThreshold > 0) (ts as any).tier = 'S';
    else if (ts.score >= aThreshold)              (ts as any).tier = 'A';
    else if (ts.score >= bThreshold)              (ts as any).tier = 'B';
    else                                          (ts as any).tier = 'C';
    result.set(account, ts);
  }

  return result;
}

// ─── Legacy scoreToTier (kept for backward compat) ───────────────────────────
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
  'Swing Trader': { icon: '📈', color: 'text-accent',    desc: 'Follows daily/weekly trends' },
  'Whale':        { icon: '🐋', color: 'text-[#60a5fa]', desc: 'High-volume, market-moving positions' },
  'High Risk':    { icon: '🔥', color: 'text-danger',    desc: 'No stop-loss / high volatility' },
  'Balanced':     { icon: '⚖️', color: 'text-text2',     desc: 'Balanced risk/reward profile' },
};
