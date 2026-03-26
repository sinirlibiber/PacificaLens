'use client';

import { AccountInfo, Position } from '@/lib/pacifica';
import { fmt } from '@/lib/utils';

interface StatsBarProps {
  accountInfo: AccountInfo | null;
  positions: Position[];
  accountSize: number;
  availableBalance?: number;
}

export function StatsBar({ accountInfo, positions, accountSize, availableBalance }: StatsBarProps) {
  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;
  const available = availableBalance ?? (accountInfo ? Number(accountInfo.available_to_spend || 0) : Math.max(0, accountSize - totalMarginUsed));
  const totalFunding = positions.reduce((s, p) => s + Number(p.funding || 0), 0);
  const portfolioRiskPct = equity > 0 ? Math.min((totalMarginUsed / equity) * 100, 100) : 0;
  const riskColor = portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger';

  const stats = [
    {
      label: 'Account Equity',
      value: equity > 0 ? `$${fmt(equity, 2)}` : '—',
      sub: accountInfo ? `Balance: $${fmt(Number(accountInfo.balance), 2)}` : 'Connect wallet',
      color: 'text-accent',
    },
    {
      label: 'Available',
      value: equity > 0 ? `$${fmt(available, 2)}` : '—',
      sub: `Margin used: $${fmt(totalMarginUsed, 2)}`,
      color: available < totalMarginUsed * 0.2 ? 'text-danger' : 'text-text1',
    },
    {
      label: 'Open Positions',
      value: String(positions.length),
      sub: `${positions.filter(p => p.side === 'bid').length}L · ${positions.filter(p => p.side === 'ask').length}S`,
      color: 'text-text1',
    },
    {
      label: 'Portfolio Risk',
      value: `${fmt(portfolioRiskPct, 1)}%`,
      sub: 'Margin / equity',
      color: riskColor,
    },
    {
      label: 'Funding Paid',
      value: `${totalFunding >= 0 ? '+' : ''}$${fmt(totalFunding, 4)}`,
      sub: 'Since position open',
      color: totalFunding >= 0 ? 'text-success' : 'text-danger',
    },
  ];

  return (
    <div className="grid border border-border1 bg-surface rounded-t-2xl mt-5 overflow-hidden"
      style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
      {stats.map((s, i) => (
        <div key={s.label} className={`px-4 py-3.5 ${i < stats.length - 1 ? 'border-r border-border1' : ''}`}>
          <div className="text-[9px] text-text3 uppercase tracking-widest mb-1 font-semibold">{s.label}</div>
          <div className={`text-[18px] font-bold ${s.color}`}>{s.value}</div>
          <div className="text-[10px] text-text3 mt-0.5">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}