'use client';

import { AccountInfo, Position } from '@/lib/pacifica';
import { fmt } from '@/lib/utils';

interface StatsBarProps {
  accountInfo: AccountInfo | null;
  positions: Position[];
  accountSize: number;
}

export function StatsBar({ accountInfo, positions, accountSize }: StatsBarProps) {
  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;
  const totalFunding = positions.reduce((s, p) => s + Number(p.funding || 0), 0);
  const portfolioRiskPct = equity > 0 ? Math.min((totalMarginUsed / equity) * 100, 100) : 0;

  const riskColor = portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger';

  const stats = [
    { label: 'Account Equity', value: equity > 0 ? `$${fmt(equity, 2)}` : '—', sub: accountInfo ? `Balance: $${fmt(Number(accountInfo.balance), 2)}` : 'Connect wallet', color: 'text-accent' },
    { label: 'Open Positions', value: String(positions.length), sub: `Margin used: $${fmt(totalMarginUsed, 2)}`, color: 'text-text1' },
    { label: 'Portfolio Risk', value: `${fmt(portfolioRiskPct, 1)}%`, sub: 'Margin / equity', color: riskColor },
    { label: 'Funding Paid', value: `${totalFunding >= 0 ? '+' : ''}$${fmt(totalFunding, 4)}`, sub: 'Since position open', color: totalFunding >= 0 ? 'text-success' : 'text-danger' },
  ];

  return (
    <div className="grid grid-cols-4 border-b border-border1 bg-surface shrink-0">
      {stats.map((s, i) => (
        <div key={s.label} className={`px-5 py-4 ${i < 3 ? 'border-r border-border1' : ''}`}>
          <div className="text-[10px] text-text3 uppercase tracking-widest mb-1.5 font-semibold">{s.label}</div>
          <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-[10px] text-text3 mt-0.5">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}
