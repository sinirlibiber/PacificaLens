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

  const riskColor = portfolioRiskPct < 10 ? 'var(--success)' : portfolioRiskPct < 25 ? 'var(--warn)' : 'var(--danger)';

  const stats = [
    {
      label: 'Account Equity',
      value: equity > 0 ? `$${fmt(equity, 2)}` : '—',
      sub: accountInfo ? `Balance: $${fmt(Number(accountInfo.balance), 2)}` : 'Connect wallet',
      color: 'var(--accent)',
    },
    {
      label: 'Available',
      value: equity > 0 ? `$${fmt(available, 2)}` : '—',
      sub: `Margin used: $${fmt(totalMarginUsed, 2)}`,
      color: available < totalMarginUsed * 0.2 ? 'var(--danger)' : 'var(--text1)',
    },
    {
      label: 'Open Positions',
      value: String(positions.length),
      sub: `${positions.filter(p => p.side === 'bid').length}L · ${positions.filter(p => p.side === 'ask').length}S`,
      color: 'var(--text1)',
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
      color: totalFunding >= 0 ? 'var(--success)' : 'var(--danger)',
    },
  ];

  return (
    <div className="grid rounded-t-2xl mt-5 overflow-hidden"
      style={{
        gridTemplateColumns: 'repeat(5, 1fr)',
        border: '1px solid var(--border1)',
        background: 'var(--surface)',
      }}>
      {stats.map((s, i) => (
        <div key={s.label}
          className="px-4 py-3.5"
          style={{ borderRight: i < stats.length - 1 ? '1px solid var(--border1)' : 'none' }}>
          <div className="text-[9px] uppercase tracking-widest mb-1 font-semibold" style={{ color: 'var(--text3)' }}>{s.label}</div>
          <div className="text-[18px] font-bold" style={{ color: s.color }}>{s.value}</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}
