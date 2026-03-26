'use client';

import { useState } from 'react';
import { TraderScore, ScoreTier, STYLE_META } from '@/lib/traderScore';

export const TIER_LABELS: Record<ScoreTier, string> = {
  S: 'Elite — Top 5%',
  A: 'Strong — Top 20%',
  B: 'Average — Top 45%',
  C: 'Weak — Bottom 55%',
};

// CSS-var-safe tier styles (no Tailwind opacity bg trick)
const TIER_STYLE: Record<ScoreTier, { cls: string; glow?: string }> = {
  S: { cls: 'score-s',      glow: '0 0 8px rgba(192,132,252,0.5)' },
  A: { cls: 'score-a',      glow: undefined },
  B: { cls: 'score-b',      glow: undefined },
  C: { cls: 'score-c',      glow: undefined },
};

// Fallback for A+ if tier comes through as string
function tierClass(tier: string): string {
  if (tier === 'A+') return 'score-a-plus';
  return TIER_STYLE[tier as ScoreTier]?.cls ?? 'score-c';
}

interface ScoreBadgeProps {
  score: TraderScore | null;
  showNumber?: boolean;
}

export function ScoreBadge({ score, showNumber = true }: ScoreBadgeProps) {
  const [showTip, setShowTip] = useState(false);

  if (!score) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-[10px]" style={{ color: 'var(--text3)' }}>—</span>
      </div>
    );
  }

  const styleMeta = STYLE_META[score.style];
  const tc = tierClass(score.tier);
  const glow = TIER_STYLE[score.tier as ScoreTier]?.glow;

  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="text-[11px]" style={{ color: 'var(--text3)' }} title={score.style}>
        {styleMeta.icon}
      </span>
      {showNumber && (
        <span className={`text-[11px] font-mono font-semibold ${tc}`}>
          {score.score}
        </span>
      )}
      <div className="relative"
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}>
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-[10px] font-bold border cursor-help ${tc}`}
          style={glow ? { boxShadow: glow } : {}}
        >
          {score.tier}
        </span>
        {showTip && (
          <div className="absolute bottom-full right-0 mb-1.5 z-50 pointer-events-none">
            <div className="rounded-xl px-3 py-2 shadow-lg whitespace-nowrap"
              style={{ background: 'var(--surface)', border: '1px solid var(--border1)', boxShadow: 'var(--shadow-md)' }}>
              <div className={`text-[11px] font-bold ${tc}`}>{TIER_LABELS[score.tier as ScoreTier] ?? score.tier}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>Score: {score.score} / 100</div>
              <div className={`text-[10px] mt-1 font-semibold ${tc}`}>{styleMeta.icon} {score.style}</div>
              <div className="text-[9px] mt-1 space-y-0.5" style={{ color: 'var(--text3)' }}>
                <div>PnL <span style={{ color: 'var(--text2)' }}>{score.breakdown.pnl}/30</span></div>
                <div>Consistency <span style={{ color: 'var(--text2)' }}>{score.breakdown.consistency}/20</span></div>
                <div>EPR <span style={{ color: 'var(--text2)' }}>{score.breakdown.epr}/20</span></div>
                <div>Win Rate <span style={{ color: 'var(--text2)' }}>{score.breakdown.winRate}/15</span></div>
                <div>Drawdown <span style={{ color: 'var(--text2)' }}>{score.breakdown.drawdown}/10</span></div>
                <div>OI Risk <span style={{ color: 'var(--text2)' }}>{score.breakdown.oiRisk}/5</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Expanded ScoreCard (trader drawer) ──────────────────────────────────────

interface ScoreCardProps {
  score: TraderScore;
}

export function ScoreCard({ score }: ScoreCardProps) {
  const tc = tierClass(score.tier);
  const glow = TIER_STYLE[score.tier as ScoreTier]?.glow;
  const styleMeta = STYLE_META[score.style];

  const lastUpdated = new Date(score.lastUpdated);
  const updatedStr = lastUpdated.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const bars: { label: string; value: number; max: number; color: string }[] = [
    { label: 'PnL',         value: score.breakdown.pnl,         max: 30, color: 'var(--success)' },
    { label: 'Consistency', value: score.breakdown.consistency,  max: 20, color: 'var(--accent)' },
    { label: 'EPR',         value: score.breakdown.epr,          max: 20, color: '#818cf8' },
    { label: 'Win Rate',    value: score.breakdown.winRate,      max: 15, color: 'var(--warn)' },
    { label: 'Drawdown',    value: score.breakdown.drawdown,     max: 10, color: '#34d399' },
    { label: 'OI Risk',     value: score.breakdown.oiRisk,       max: 5,  color: '#a78bfa' },
  ];

  return (
    <div className={`rounded-2xl overflow-hidden ${tc}`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border1)',
        boxShadow: glow ? `0 0 12px rgba(0,0,0,0.3), ${glow}` : 'var(--shadow)',
      }}>
      <div className="px-3 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border1)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text2)' }}>Trader Score</span>
          <span className="text-[9px]" style={{ color: 'var(--text3)' }}>{updatedStr}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[22px] font-bold font-mono ${tc}`}>{score.score}</span>
          <span className={`flex items-center justify-center w-8 h-8 rounded-xl text-[14px] font-bold border cursor-help ${tc}`}
            style={glow ? { boxShadow: glow } : {}}>
            {score.tier}
          </span>
        </div>
      </div>

      <div className="px-3 pt-2.5">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold ${tc}`}
          style={{ borderColor: 'currentColor', opacity: 1 }}>
          <span>{styleMeta.icon}</span>
          <span>{score.style}</span>
          <span className="font-normal" style={{ color: 'var(--text3)' }}>— {styleMeta.desc}</span>
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2">
        {bars.map(b => (
          <div key={b.label}>
            <div className="flex justify-between mb-1">
              <span className="text-[10px]" style={{ color: 'var(--text3)' }}>{b.label}</span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text2)' }}>{b.value} / {b.max}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface2)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(b.value / b.max) * 100}%`, background: b.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
