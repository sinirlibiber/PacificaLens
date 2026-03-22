'use client';

import { Position, Ticker } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice, getMarkPrice } from '@/lib/utils';

export function PositionsTable({ positions, tickers }: { positions: Position[]; tickers: Record<string, Ticker>; }) {
  return (
    <div className="border-t border-border1 bg-surface shrink-0 max-h-52 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border1 bg-surface2 sticky top-0 z-10">
        <span className="text-[11px] font-semibold text-text2 uppercase tracking-wide">Open Positions</span>
        <span className="text-[10px] text-text3 bg-surface px-2 py-0.5 rounded-full border border-border1">{positions.length} active</span>
      </div>
      {positions.length > 0 ? (
        <table className="w-full">
          <thead>
            <tr className="border-b border-border1">
              {['Market', 'Side', 'Size', 'Entry', 'Mark', 'Funding', 'Mode'].map(h => (
                <th key={h} className="text-[10px] text-text3 uppercase tracking-wider font-semibold px-4 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const tk = tickers[p.symbol];
              const markPx = getMarkPrice(tk);
              const isLong = p.side === 'bid';
              const fundingPaid = Number(p.funding || 0);
              return (
                <tr key={i} className="border-b border-border1 last:border-0 hover:bg-surface2 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <CoinLogo symbol={p.symbol} size={20} />
                      <span className="text-[13px] font-semibold text-text1">{p.symbol}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-text1 font-mono">{fmt(Math.abs(Number(p.amount || 0)), 4)}</td>
                  <td className="px-4 py-2.5 text-[12px] text-text1 font-mono">${fmtPrice(p.entry_price)}</td>
                  <td className="px-4 py-2.5 text-[12px] text-text1 font-mono">${fmtPrice(markPx)}</td>
                  <td className={`px-4 py-2.5 text-[12px] font-mono font-medium ${fundingPaid >= 0 ? 'text-success' : 'text-danger'}`}>
                    {fundingPaid >= 0 ? '+' : ''}${fmt(fundingPaid, 4)}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-text3">{p.isolated ? 'Isolated' : 'Cross'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="py-8 text-center text-[12px] text-text3">No open positions</div>
      )}
    </div>
  );
}
