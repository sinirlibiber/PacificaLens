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

export function Results({ result, accountInfo, accountSize, onExecute, walletConnected }: ResultsProps) {
  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;
  const portfolioRiskPct = equity > 0 ? Math.min((totalMarginUsed / equity) * 100, 100) : 0;
  const riskColor = portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger';
  const riskBg = portfolioRiskPct < 10 ? '#10b981' : portfolioRiskPct < 25 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto bg-bg h-full">

      {/* Portfolio risk compact bar */}
      <div className="bg-surface rounded-xl border border-border1 shadow-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-text2">Portfolio Risk</span>
          <span className={"text-[14px] font-bold " + riskColor}>{fmt(portfolioRiskPct, 1)}%</span>
        </div>
        <div className="h-2 bg-surface2 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: Math.min(portfolioRiskPct * 2, 100) + '%', background: riskBg }} />
        </div>
        <div className="flex justify-between text-[9px] text-text3 mt-1">
          <span>Safe</span><span>10%</span><span>25%</span><span>50%+</span>
        </div>
        {equity > 0 && (
          <div className="flex justify-between mt-2 text-[10px] text-text3">
            <span>Equity: <span className="text-text1 font-semibold">${fmt(equity, 2)}</span></span>
            <span>Margin used: <span className="text-warn font-semibold">${fmt(totalMarginUsed, 2)}</span></span>
          </div>
        )}
      </div>

      {result ? (
        <>
          {/* Position size card */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border1 bg-surface2">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Position Size</span>
              <span className={"px-2.5 py-0.5 rounded-full text-[10px] font-bold " + (result.side === 'long' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
                {result.side.toUpperCase()}
              </span>
            </div>
            <div className="divide-y divide-border1">
              {[
                { label: 'Contracts', value: fmt(result.positionSize, 4), color: 'text-accent font-bold' },
                { label: 'Position value', value: '$' + fmt(result.positionValue, 2), color: '' },
                { label: 'Required margin', value: '$' + fmt(result.requiredMargin, 2), color: result.marginPct > 50 ? 'text-danger' : '' },
                { label: 'Margin usage', value: fmt(result.marginPct, 1) + '%', color: result.marginPct > 50 ? 'text-danger' : result.marginPct > 25 ? 'text-warn' : 'text-success' },
              ].map(row => (
                <div key={row.label} className="flex justify-between px-4 py-2.5 hover:bg-surface2/50">
                  <span className="text-[12px] text-text3">{row.label}</span>
                  <span className={"text-[13px] font-semibold " + (row.color || 'text-text1')}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk / Reward */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border1 bg-surface2">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Risk / Reward</span>
            </div>
            <div className="divide-y divide-border1">
              {[
                { label: 'Max risk', value: '$' + fmt(result.riskAmount, 2), color: 'text-danger' },
                { label: 'SL distance', value: fmt(result.slPct, 2) + '%', color: '' },
                { label: 'Liquidation price', value: '$' + fmtPrice(result.liquidationPrice), color: 'text-danger' },
                { label: 'TP at 2:1 RR', value: '$' + fmtPrice(result.tp2), color: 'text-success' },
                { label: 'TP at 3:1 RR', value: '$' + fmtPrice(result.tp3), color: 'text-success' },
              ].map(row => (
                <div key={row.label} className="flex justify-between px-4 py-2.5 hover:bg-surface2/50">
                  <span className="text-[12px] text-text3">{row.label}</span>
                  <span className={"text-[13px] font-semibold " + (row.color || 'text-text1')}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => onExecute(result)}
            disabled={!walletConnected}
            className={"w-full py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-40 shadow-card-md " +
              (result.side === 'long' ? 'bg-success text-white hover:opacity-90' : 'bg-danger text-white hover:opacity-90')}>
            {walletConnected ? `Place ${result.side.toUpperCase()} Order` : 'Connect Wallet'}
          </button>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12 text-text3">
          <div className="w-14 h-14 rounded-2xl border border-dashed border-border2 flex items-center justify-center text-2xl">◎</div>
          <p className="text-sm text-text2 font-semibold">No calculation yet</p>
          <p className="text-xs">Fill the calculator and press Calculate</p>
        </div>
      )}
    </div>
  );
}
