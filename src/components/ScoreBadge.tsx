'use client';

import { useState } from 'react';
import { TraderScore, ScoreTier, TIER_COLORS } from '@/lib/traderScore';

// ─── Tier tooltip labels ──────────────────────────────────────────────────────

export const TIER_LABELS: Record<ScoreTier, string> = {
  S: 'Elite — Top 5%',
  A: 'Strong — Top 15%',
  B: 'Average — Top 35%',
  C: 'Weak — Bottom 40%',
  D: 'Low performance',
};

// ─── Compact badge (leaderboard table) ───────────────────────────────────────

interface ScoreBadgeProps {
  score: TraderScore | null;
  showNumber?: boolean;
}

export function ScoreBadge({ score, showNumber = true }: ScoreBadgeProps) {
  const [showTip, setShowTip] = useState(false);

  if (!score) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-[10px] text-text3">—</span>
      </div>
    );
  }

  const { bg, text, border } = TIER_COLORS[score.tier];
  const isS = score.tier === 'S';

  return (
    <div className="flex items-center justify-end gap-1.5">
      {showNumber && (
        <span className={`text-[11px] font-mono font-semibold ${text}`}>
          {score.score}
        </span>
      )}
      <div className="relative"
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}>
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] font-bold border cursor-help
            ${bg} ${text} ${border}
            ${isS ? 'shadow-[0_0_6px_rgba(251,191,36,0.5)]' : ''}
          `}
        >
          {score.tier}
        </span>
        {showTip && (
          <div className="absolute bottom-full right-0 mb-1.5 z-50 pointer-events-none">
            <div className="bg-surface border border-border1 rounded-lg px-2.5 py-1.5 shadow-md whitespace-nowrap">
              <div className={`text-[11px] font-bold ${text}`}>{TIER_LABELS[score.tier]}</div>
              <div className="text-[10px] text-text3 mt-0.5">
                Score: {score.score} / 100
              </div>
              <div className="text-[9px] text-text3 mt-1 space-y-0.5">
                <div>PnL <span className="text-text2">{score.breakdown.pnl}/40</span></div>
                <div>Consistency <span className="text-text2">{score.breakdown.consistency}/25</span></div>
                <div>Volume <span className="text-text2">{score.breakdown.volume}/20</span></div>
                <div>Efficiency <span className="text-text2">{score.breakdown.risk}/15</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Expanded score card (trader drawer) ─────────────────────────────────────

interface ScoreCardProps {
  score: TraderScore;
}

export function ScoreCard({ score }: ScoreCardProps) {
  const { text, border } = TIER_COLORS[score.tier];
  const isS = score.tier === 'S';

  const lastUpdated = new Date(score.lastUpdated);
  const updatedStr = lastUpdated.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const bars: { label: string; value: number; max: number; color: string }[] = [
    { label: 'PnL',         value: score.breakdown.pnl,        max: 40, color: 'bg-success' },
    { label: 'Consistency', value: score.breakdown.consistency, max: 25, color: 'bg-accent' },
    { label: 'Volume',      value: score.breakdown.volume,      max: 20, color: 'bg-warn' },
    { label: 'Efficiency',  value: score.breakdown.risk,        max: 15, color: 'bg-[#a78bfa]' },
  ];

  return (
    <div className={`border ${border} rounded-xl bg-surface overflow-hidden ${isS ? 'shadow-[0_0_10px_rgba(251,191,36,0.2)]' : ''}`}>
      {/* Header */}
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-border1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text2 uppercase tracking-wide">
            Trader Score
          </span>
          <span className="text-[9px] text-text3">{updatedStr}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[22px] font-bold font-mono ${text}`}>
            {score.score}
          </span>
          <div className="relative group">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-lg text-[14px] font-bold border cursor-help
                ${TIER_COLORS[score.tier].bg} ${text} ${border}
                ${isS ? 'shadow-[0_0_8px_rgba(251,191,36,0.5)]' : ''}
              `}
            >
              {score.tier}
            </span>
            <div className="absolute bottom-full right-0 mb-1.5 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="bg-surface border border-border1 rounded-lg px-2.5 py-1.5 shadow-md whitespace-nowrap">
                <div className={`text-[11px] font-bold ${text}`}>{TIER_LABELS[score.tier]}</div>
              </div>
            </div>
          </div>
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
