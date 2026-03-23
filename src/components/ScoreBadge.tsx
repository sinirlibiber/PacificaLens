'use client';

import { TraderScore, ScoreTier, TIER_COLORS } from '@/lib/traderScore';

// ─── Compact badge (leaderboard table) ───────────────────────────────────────

interface ScoreBadgeProps {
  score: TraderScore | null;
  showNumber?: boolean;
}

export function ScoreBadge({ score, showNumber = true }: ScoreBadgeProps) {
  if (!score) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-[10px] text-text3">—</span>
      </div>
    );
  }

  const { bg, text, border } = TIER_COLORS[score.tier];

  return (
    <div className="flex items-center justify-end gap-1.5">
      {showNumber && (
        <span className={`text-[11px] font-mono font-semibold ${text}`}>
          {score.score}
        </span>
      )}
      <span
        className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] font-bold border ${bg} ${text} ${border}`}
      >
        {score.tier}
      </span>
    </div>
  );
}

// ─── Expanded score card (trader drawer) ─────────────────────────────────────

interface ScoreCardProps {
  score: TraderScore;
}

export function ScoreCard({ score }: ScoreCardProps) {
  const { text, border } = TIER_COLORS[score.tier];

  const lastUpdated = new Date(score.lastUpdated);
  const updatedStr = lastUpdated.toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const bars: { label: string; value: number; max: number; color: string }[] = [
    { label: 'PnL',         value: score.breakdown.pnl,         max: 40, color: 'bg-success' },
    { label: 'Tutarlılık',  value: score.breakdown.consistency,  max: 25, color: 'bg-accent' },
    { label: 'Hacim',       value: score.breakdown.volume,       max: 20, color: 'bg-warn' },
    { label: 'Verimlilik',  value: score.breakdown.risk,         max: 15, color: 'bg-[#a78bfa]' },
  ];

  return (
    <div className={`border ${border} rounded-xl bg-surface overflow-hidden`}>
      {/* Header */}
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-border1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text2 uppercase tracking-wide">
            Trader Skoru
          </span>
          <span className="text-[9px] text-text3">{updatedStr}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[22px] font-bold font-mono ${text}`}>
            {score.score}
          </span>
          <span
            className={`flex items-center justify-center w-8 h-8 rounded-lg text-[14px] font-bold border ${TIER_COLORS[score.tier].bg} ${text} ${border}`}
          >
            {score.tier}
          </span>
        </div>
      </div>

      {/* Breakdown bars */}
      <div className="px-3 py-2.5 space-y-2">
        {bars.map((b) => (
          <div key={b.label}>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-text3">{b.label}</span>
              <span className="text-[10px] font-mono text-text2">
                {b.value} / {b.max}
              </span>
            </div>
            <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${b.color} transition-all duration-500`}
                style={{ width: `${(b.value / b.max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tier legend (optional, for tooltips) ────────────────────────────────────

export const TIER_LABELS: Record<ScoreTier, string> = {
  S: 'Elite — Top %5',
  A: 'Güçlü — Top %15',
  B: 'Orta — Top %35',
  C: 'Zayıf — Alt %40',
  D: 'Düşük performans',
};
