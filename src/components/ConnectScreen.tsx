'use client';

import { usePrivy } from '@privy-io/react-auth';
import Image from 'next/image';

const FEATURES = [
  {
    label: 'Real-time Data',
    desc: 'Live market feeds across all Pacifica pairs',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    label: 'Solana Native',
    desc: 'Built for speed on Solana L1 infrastructure',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    label: 'Direct Execute',
    desc: 'Place and manage orders without leaving the dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
  },
  {
    label: 'Portfolio Risk',
    desc: 'PnL tracking, liquidation alerts and exposure metrics',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

export function ConnectScreen() {
  const { login } = usePrivy();

  return (
    <div className="relative flex flex-col items-center justify-center h-full overflow-hidden bg-bg px-4">

      {/* Subtle background grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-text1) 1px, transparent 1px), linear-gradient(90deg, var(--color-text1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Glow blob */}
      <div
        className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[320px] rounded-full opacity-10 blur-[96px]"
        style={{ background: 'var(--color-accent)' }}
      />

      {/* Card */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-md w-full">

        {/* Logo + name */}
        <div className="flex items-center gap-3 mb-7">
          <Image
            src="/pacificalens.ico"
            alt="PacificaLens"
            width={52}
            height={52}
            className="object-contain"
          />
          <span className="font-bold text-[26px] tracking-tight text-text1">PACIFICALENS</span>
        </div>

        {/* Tagline */}
        <p className="text-[14px] text-text2 leading-relaxed max-w-xs mb-8">
          Advanced analytics and risk management for{' '}
          <span className="text-text1 font-medium">Pacifica DEX</span> — market overview,
          position sizing, arbitrage scanning and whale intelligence.
        </p>

        {/* CTA */}
        <button
          onClick={login}
          className="w-full max-w-[220px] bg-accent text-white font-semibold text-[14px] py-3.5 rounded-xl hover:bg-accent2 transition-colors shadow-card-md mb-10"
        >
          Connect Wallet
        </button>

        {/* Divider */}
        <div className="w-full flex items-center gap-3 mb-8">
          <div className="flex-1 h-px bg-border1" />
          <span className="text-[11px] text-text3 tracking-widest uppercase">Features</span>
          <div className="flex-1 h-px bg-border1" />
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 gap-3 w-full">
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="flex flex-col gap-2 p-4 rounded-xl border border-border1 bg-surface text-left hover:border-accent/30 transition-colors"
            >
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface2 border border-border1 text-accent">
                {f.icon}
              </div>
              <div>
                <div className="text-[12px] font-semibold text-text1 mb-0.5">{f.label}</div>
                <div className="text-[11px] text-text3 leading-relaxed">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="mt-8 text-[11px] text-text3">
          Supports Phantom, Solflare, Backpack and all Solana wallets via Privy
        </p>
      </div>
    </div>
  );
}
