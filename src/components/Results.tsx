'use client';

import { CalcResult } from './Calculator';
import { fmtPrice, fmt } from '@/lib/utils';
import { Position, AccountInfo } from '@/lib/pacifica';

interface ResultsProps {
  result: CalcResult | null;
  positions: Position[];
  accountInfo: AccountInfo | null;
  accountSize: number;
  onExecute: (r: CalcResult) => void;
  walletConnected: boolean;
  market: string;
}

function StatRow({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between items-center px-4 py-2.5 hover:bg-surface2/50 transition-colors ${highlight ? 'bg-accent/5' : ''}`}>
      <span className="text-[12px] text-text3">{label}</span>
      <span className={`text-[13px] font-semibold ${color || 'text-text1'}`}>{value}</span>
    </div>
  );
}

function WarningBanner({ msg, type }: { msg: string; type: 'warn' | 'danger' | 'info' }) {
  const s = type === 'danger' ? 'bg-danger/8 border-danger/30 text-danger' : type === 'warn' ? 'bg-warn/8 border-warn/30 text-warn' : 'bg-accent/8 border-accent/30 text-accent';
  const icon = type === 'danger' ? '⚡' : type === 'warn' ? '⚠' : 'ℹ';
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold ${s}`}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span>{msg}</span>
    </div>
  );
}

export function Results({ result, accountInfo, accountSize, onExecute, walletConnected, market }: ResultsProps) {
  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;
  const portfolioRiskPct = equity > 0 ? Math.min((totalMarginUsed / equity) * 100, 100) : 0;
  const riskColor = portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger';
  const riskBg = portfolioRiskPct < 10 ? '#10b981' : portfolioRiskPct < 25 ? '#f59e0b' : '#ef4444';

  // Smart warnings for result
  const warnings: { msg: string; type: 'warn' | 'danger' | 'info' }[] = [];
  if (result) {
    if (result.marginPct > 50) warnings.push({ msg: 'This position uses over 50% of your account as margin', type: 'danger' });
    if (result.leverage > 20) warnings.push({ msg: `${result.leverage}x leverage is very high — small moves can cause liquidation`, type: 'danger' });
    if (result.rrRatio < 1.5) warnings.push({ msg: 'Risk:Reward below 1.5 — this trade has an unfavorable payout ratio', type: 'warn' });
    if (result.fundingCostDaily > result.riskAmount * 0.1) warnings.push({ msg: `Daily funding ($${fmt(result.fundingCostDaily, 2)}) is over 10% of your risk amount`, type: 'warn' });
    if (portfolioRiskPct + result.marginPct > 50) warnings.push({ msg: 'Adding this position will push total margin usage above 50%', type: 'warn' });
    if (result.slPct < 0.3) warnings.push({ msg: 'Stop loss is very tight — likely to be hit by normal volatility', type: 'warn' });
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto bg-bg h-full">

      {/* Portfolio Risk bar — compact, no duplicate */}
      <div className="bg-surface rounded-xl border border-border1 shadow-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-text2">Portfolio Risk</span>
          <span className={`text-[14px] font-bold ${riskColor}`}>{fmt(portfolioRiskPct, 1)}%</span>
        </div>
        <div className="h-2 bg-surface2 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: Math.min(portfolioRiskPct * 2, 100) + '%', background: riskBg }} />
        </div>
        {equity > 0 && (
          <div className="flex justify-between mt-2 text-[10px] text-text3">
            <span>Equity: <span className="text-text1 font-semibold">${fmt(equity, 2)}</span></span>
            <span>Margin: <span className="text-warn font-semibold">${fmt(totalMarginUsed, 2)}</span></span>
          </div>
        )}
      </div>

      {result ? (
        <>
          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((w, i) => <WarningBanner key={i} msg={w.msg} type={w.type} />)}
            </div>
          )}

          {/* RR + EV highlight card */}
          <div className={`rounded-xl border p-3.5 ${result.rrRatio >= 2 ? 'bg-success/5 border-success/25' : result.rrRatio >= 1.5 ? 'bg-warn/5 border-warn/20' : 'bg-danger/5 border-danger/20'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-0.5">Risk : Reward</div>
                <div className={`text-[22px] font-bold ${result.rrRatio >= 2 ? 'text-success' : result.rrRatio >= 1.5 ? 'text-warn' : 'text-danger'}`}>
                  1 : {fmt(result.rrRatio, 1)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-0.5">Expected Value</div>
                {/* EV = 0.5 × reward - 0.5 × risk (50% win rate assumption) */}
                <div className={`text-[18px] font-bold ${(result.rrRatio - 1) * 0.5 * result.riskAmount > 0 ? 'text-success' : 'text-danger'}`}>
                  {(result.rrRatio - 1) * 0.5 >= 0 ? '+' : ''}${fmt((result.rrRatio - 1) * 0.5 * result.riskAmount, 2)}
                </div>
                <div className="text-[9px] text-text3">@ 50% win rate</div>
              </div>
            </div>
            {/* RR bar */}
            <div className="mt-2.5 flex h-2 rounded-full overflow-hidden">
              <div className="bg-danger/70" style={{ width: `${(1 / (1 + result.rrRatio)) * 100}%` }} />
              <div className="bg-success/70 flex-1" />
            </div>
            <div className="flex justify-between text-[9px] mt-1 text-text3">
              <span className="text-danger">Risk ${fmt(result.riskAmount, 2)}</span>
              <span className="text-success">Reward ${fmt(result.riskAmount * result.rrRatio, 2)}</span>
            </div>
          </div>

          {/* Position Size */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border1 bg-surface2">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Position Size</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${result.side === 'long' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                {result.side.toUpperCase()}
              </span>
            </div>
            <div className="divide-y divide-border1">
              <StatRow label="Contracts" value={fmt(result.positionSize, 4)} color="text-accent font-bold" />
              <StatRow label="Position Value" value={'$' + fmt(result.positionValue, 2)} />
              <StatRow label="Required Margin" value={'$' + fmt(result.requiredMargin, 2)} color={result.marginPct > 50 ? 'text-danger' : undefined} />
              <StatRow label="Margin Usage" value={fmt(result.marginPct, 1) + '%'} color={result.marginPct > 50 ? 'text-danger' : result.marginPct > 25 ? 'text-warn' : 'text-success'} />
              <StatRow label="Leverage" value={result.leverage + 'x'} color={result.leverage > 20 ? 'text-danger' : 'text-accent'} />
            </div>
          </div>

          {/* Risk / Reward details */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border1 bg-surface2">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Risk / Reward</span>
            </div>
            <div className="divide-y divide-border1">
              <StatRow label="Max Risk ($)" value={'$' + fmt(result.riskAmount, 2)} color="text-danger" />
              <StatRow label="SL Distance" value={fmt(result.slPct, 2) + '%'} />
              <StatRow label="Liquidation Price" value={'$' + fmtPrice(result.liquidationPrice)} color="text-danger" />
              <StatRow label="Break-Even Price" value={'$' + fmtPrice(result.breakEvenPrice)} color="text-text3" />
              <StatRow label={`TP @ 1:${fmt(result.rrRatio, 1)}`} value={'$' + fmtPrice(result.tp1)} color="text-success" highlight />
              <StatRow label="TP @ 1:2" value={'$' + fmtPrice(result.tp2)} color="text-success" />
              <StatRow label="TP @ 1:3" value={'$' + fmtPrice(result.tp3)} color="text-success" />
            </div>
          </div>

          {/* Funding Cost */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border1 bg-surface2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Funding Cost (hold)</span>
              <span className="text-[9px] text-text3">assumes constant rate</span>
            </div>
            <div className="divide-y divide-border1">
              <StatRow label="Daily Cost" value={'$' + fmt(result.fundingCostDaily, 4)} color={result.fundingCostDaily > 0 ? 'text-danger' : 'text-success'} />
              <StatRow label="Weekly Cost" value={'$' + fmt(result.fundingCostWeekly, 2)} color={result.fundingCostWeekly > 0 ? 'text-danger' : 'text-success'} />
              <StatRow
                label="Weekly vs Risk"
                value={result.riskAmount > 0 ? fmt((result.fundingCostWeekly / result.riskAmount) * 100, 1) + '%' : '—'}
                color={result.fundingCostWeekly / result.riskAmount > 0.2 ? 'text-danger' : 'text-text3'}
              />
            </div>
          </div>

          <button
            onClick={() => onExecute(result)}
            disabled={!walletConnected}
            className={`w-full py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-40 shadow-card-md ${result.side === 'long' ? 'bg-success text-white hover:opacity-90' : 'bg-danger text-white hover:opacity-90'}`}>
            {walletConnected ? `Place ${result.side.toUpperCase()} Order on ${market}` : 'Connect Wallet to Trade'}
          </button>
        </>
      ) : (
        <div className="flex-1 flex flex-col gap-4">
          {/* Helpful empty state with market info */}
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-text3">
            <div className="w-14 h-14 rounded-2xl border border-dashed border-border2 flex items-center justify-center text-2xl">◎</div>
            <p className="text-sm text-text2 font-semibold">Fill the calculator</p>
            <p className="text-xs text-center leading-relaxed max-w-[200px]">
              Enter entry price, stop loss and account size to calculate your position
            </p>
          </div>

          {/* Quick reference card */}
          <div className="bg-surface rounded-xl border border-border1 p-4 space-y-3">
            <div className="text-[10px] font-bold text-text3 uppercase tracking-wide">Quick Reference</div>
            <div className="space-y-2 text-[11px]">
              {[
                { icon: '🟢', text: 'Risk ≤ 1-2% per trade for longevity' },
                { icon: '📐', text: 'Minimum 1:1.5 R:R before entering' },
                { icon: '⚡', text: 'High leverage = tight liquidation distance' },
                { icon: '💸', text: 'Funding compounds daily on held positions' },
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-2 text-text3">
                  <span>{tip.icon}</span>
                  <span>{tip.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
