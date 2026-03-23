'use client';

import { useState } from 'react';
import { Market, Ticker, FundingRate } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmtPrice, fmt, getMarkPrice, get24hChange } from '@/lib/utils';

interface MarketListProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  fundingRates?: Record<string, FundingRate>;
  selected: Market | null;
  onSelect: (m: Market) => void;
  error?: string | null;
}

export function MarketList({ markets, tickers, fundingRates, selected, onSelect, error }: MarketListProps) {
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('pl_favorites');
      return new Set(saved ? JSON.parse(saved) : []);
    } catch { return new Set(); }
  });

  function toggleFavorite(symbol: string, e: React.MouseEvent) {
    e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      try { localStorage.setItem('pl_favorites', JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }

  const filtered = markets
    .filter(m => m.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const af = favorites.has(a.symbol) ? 0 : 1;
      const bf = favorites.has(b.symbol) ? 0 : 1;
      if (af !== bf) return af - bf;
      return 0;
    });

  return (
    <aside className="flex flex-col bg-surface overflow-hidden h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border1 shrink-0">
        <span className="text-[10px] font-semibold tracking-wide text-text2 uppercase">Markets</span>
        <span className="text-[10px] text-text3 bg-surface2 px-1.5 py-0.5 rounded-full">{markets.length}</span>
      </div>
      <div className="px-2.5 py-2 shrink-0">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3 text-xs">⌕</span>
          <input
            className="w-full bg-surface2 border border-border1 rounded-lg pl-7 pr-3 py-1.5 text-[11px] text-text1 placeholder-text3 outline-none focus:border-accent transition-all"
            placeholder="Ara..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {error && <div className="mx-1 my-1 p-2 bg-danger/5 border border-danger/20 rounded-lg text-[10px] text-danger">{error}</div>}
        {filtered.map(m => {
          const tk = tickers[m.symbol];
          const fr = fundingRates?.[m.symbol];
          const price = getMarkPrice(tk);
          const change = get24hChange(tk);
          const funding = fr ? Number(fr.funding_rate) * 100 : Number(tk?.funding || 0) * 100;
          const isActive = selected?.symbol === m.symbol;
          const isFav = favorites.has(m.symbol);

          return (
            <button
              key={m.symbol}
              onClick={() => onSelect(m)}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-all ${isActive ? 'bg-accent/8 border border-accent/20' : 'hover:bg-surface2 border border-transparent'}`}
            >
              {/* Favorite star */}
              <span
                onClick={e => toggleFavorite(m.symbol, e)}
                className={`text-[11px] shrink-0 transition-colors ${isFav ? 'text-warn' : 'text-border1 hover:text-text3'}`}
              >
                {isFav ? '★' : '☆'}
              </span>
              <CoinLogo symbol={m.symbol} size={24} />
              <div className="flex-1 min-w-0 text-left">
                <div className="text-[12px] font-semibold text-text1 leading-tight">{m.symbol}</div>
                {funding !== 0 && (
                  <div className={`text-[9px] font-semibold ${funding >= 0 ? 'text-danger' : 'text-success'}`}>
                    FR {funding >= 0 ? '+' : ''}{fmt(funding, 4)}%
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-semibold text-text1 font-mono">${fmtPrice(price)}</div>
                <div className={`text-[10px] font-medium ${change >= 0 ? 'text-success' : 'text-danger'}`}>
                  {change >= 0 ? '+' : ''}{fmt(change, 2)}%
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && !error && <div className="py-8 text-center text-xs text-text3">Sonuç yok</div>}
      </div>
    </aside>
  );
}