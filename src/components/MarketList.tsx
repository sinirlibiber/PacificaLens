'use client';

import { useState } from 'react';
import { Market, Ticker } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmtPrice, fmt, getMarkPrice, get24hChange } from '@/lib/utils';

interface MarketListProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  selected: Market | null;
  onSelect: (m: Market) => void;
  error?: string | null;
}

export function MarketList({ markets, tickers, selected, onSelect, error }: MarketListProps) {
  const [search, setSearch] = useState('');
  const filtered = markets.filter(m => m.symbol.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="flex flex-col border-r border-border1 bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border1 shrink-0">
        <span className="text-[11px] font-semibold tracking-wide text-text2 uppercase">Markets</span>
        <span className="text-[10px] text-text3 bg-surface2 px-2 py-0.5 rounded-full">{markets.length}</span>
      </div>
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3 text-xs">⌕</span>
          <input
            className="w-full bg-surface2 border border-border1 rounded-lg pl-7 pr-3 py-2 text-xs text-text1 placeholder-text3 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
            placeholder="Search markets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {error && <div className="mx-2 my-2 p-2 bg-danger/5 border border-danger/20 rounded-lg text-[10px] text-danger">{error}</div>}
        {filtered.map(m => {
          const tk = tickers[m.symbol];
          const price = getMarkPrice(tk);
          const change = get24hChange(tk);
          const isActive = selected?.symbol === m.symbol;
          return (
            <button
              key={m.symbol}
              onClick={() => onSelect(m)}
              className={`w-full flex items-center gap-2.5 px-2 py-2.5 rounded-lg transition-all ${isActive ? 'bg-accent/8 border border-accent/20' : 'hover:bg-surface2 border border-transparent'}`}
            >
              <CoinLogo symbol={m.symbol} size={28} />
              <div className="flex-1 min-w-0 text-left">
                <div className="text-[13px] font-semibold text-text1">{m.symbol}</div>
                <div className="text-[10px] text-text3">{m.max_leverage}x max</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12px] font-semibold text-text1">${fmtPrice(price)}</div>
                <div className={`text-[10px] font-medium ${change >= 0 ? 'text-success' : 'text-danger'}`}>
                  {change >= 0 ? '+' : ''}{fmt(change, 2)}%
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && !error && <div className="py-8 text-center text-xs text-text3">No markets found</div>}
      </div>
    </aside>
  );
}
