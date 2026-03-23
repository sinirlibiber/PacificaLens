'use client';

import { useState } from 'react';
import { getPacificaLogoUrl, getCoinCapLogoUrl } from '@/lib/utils';

interface CoinLogoProps {
  symbol: string;
  size?: number;
}

// Try Pacifica SVG first, then CoinCap PNG, then text fallback
export function CoinLogo({ symbol, size = 28 }: CoinLogoProps) {
  const [stage, setStage] = useState<'pacifica' | 'coincap' | 'fallback'>('pacifica');
  const initials = symbol.replace(/^k/, '').slice(0, 2).toUpperCase();

  if (stage === 'fallback') {
    return (
      <div
        style={{ width: size, height: size, fontSize: size * 0.36 }}
        className="rounded-full bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-200 flex items-center justify-center font-bold text-slate-500 flex-shrink-0"
      >
        {initials}
      </div>
    );
  }

  const src = stage === 'pacifica'
    ? getPacificaLogoUrl(symbol)
    : getCoinCapLogoUrl(symbol);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={symbol}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="rounded-full flex-shrink-0 object-contain bg-surface2"
      onError={() => {
        if (stage === 'pacifica') setStage('coincap');
        else setStage('fallback');
      }}
    />
  );
}
