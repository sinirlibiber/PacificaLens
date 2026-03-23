'use client';

import { usePrivy } from '@privy-io/react-auth';
import Image from 'next/image';

const FEATURES = [
  {
    label: 'Copy Trading',
    desc: 'Follow top traders on Pacifica. Copy their positions in one click with custom leverage, SL & TP.',
    icon: '🔁',
    color: 'text-accent',
    bg: 'bg-accent/8 border-accent/20',
  },
  {
    label: 'Risk Manager',
    desc: 'Position calculator with liquidation price, risk/reward ratio, and portfolio heat map.',
    icon: '🛡️',
    color: 'text-success',
    bg: 'bg-success/8 border-success/20',
  },
  {
    label: 'Arbitrage Scanner',
    desc: 'Real-time funding rate spread across Hyperliquid, dYdX, Aster and Pacifica. Alert bot included.',
    icon: '⚡',
    color: 'text-warn',
    bg: 'bg-warn/8 border-warn/20',
  },
  {
    label: 'Whale Tracker',
    desc: 'Monitor smart money positions and liquidation events across all Pacifica markets.',
    icon: '🐋',
    color: 'text-accent',
    bg: 'bg-accent/8 border-accent/20',
  },
  {
    label: 'Market Overview',
    desc: 'Live charts, orderbook, funding rates, Fear & Greed index, top gainers and losers.',
    icon: '📊',
    color: 'text-success',
    bg: 'bg-success/8 border-success/20',
  },
  {
    label: 'Portfolio & Journal',
    desc: 'Track positions, trade history, funding, copy performance and log your trades.',
    icon: '📋',
    color: 'text-warn',
    bg: 'bg-warn/8 border-warn/20',
  },
];

export function ConnectScreen() {
  const { login } = usePrivy();

  return (
    <div className="relative flex flex-col items-center justify-center min-h-full overflow-auto bg-bg px-4 py-12">

      {/* Background grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(var(--color-text1) 1px, transparent 1px), linear-gradient(90deg, var(--color-text1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Glow */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-10 blur-[120px]"
        style={{ background: 'var(--color-accent)' }}
      />

      <div className="relative z-10 flex flex-col items-center text-center max-w-2xl w-full">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-4">
          <Image src="/logo.png" alt="PacificaLens" width={64} height={64} className="object-contain" />
          <span className="font-bold text-[28px] tracking-tight text-text1">PACIFICALENS</span>
        </div>

        {/* Tagline */}
        <p className="text-[16px] text-text2 leading-relaxed max-w-lg mb-2">
          The all-in-one analytics & trading assistant for{' '}
          <span className="text-text1 font-semibold">Pacifica DEX</span>
        </p>
        <p className="text-[13px] text-text3 mb-8 max-w-md">
          Copy top traders · Scan arbitrage · Track whales · Manage risk — all in one place, directly on-chain.
        </p>

        {/* Hackathon badge */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold mb-8">
          <span>🏆</span>
          <span>Pacifica Hackathon 2026 · Built with Pacifica Builder API</span>
        </div>

        {/* CTA */}
        <button onClick={login}
          className="px-8 py-3.5 bg-accent text-white font-bold text-[14px] rounded-xl hover:bg-accent/90 transition-all shadow-card-md mb-12 hover:scale-[1.02] active:scale-100">
          Connect Wallet to Start
        </button>

        {/* Feature grid */}
        <div className="grid grid-cols-3 gap-3 w-full mb-10">
          {FEATURES.map((f) => (
            <div key={f.label}
              className={`flex flex-col gap-2.5 p-4 rounded-xl border text-left transition-colors hover:border-opacity-60 ${f.bg}`}>
              <div className="text-[20px]">{f.icon}</div>
              <div>
                <div className={`text-[12px] font-bold mb-1 ${f.color}`}>{f.label}</div>
                <div className="text-[11px] text-text3 leading-relaxed">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 w-full border border-border1 rounded-xl p-4 bg-surface mb-8">
          {[
            { value: '6', label: 'Modules' },
            { value: '5', label: 'Exchanges Monitored' },
            { value: '100%', label: 'On-chain Execution' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-[22px] font-bold text-accent">{s.value}</div>
              <div className="text-[11px] text-text3">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-text3">
          Supports Phantom, Solflare, Backpack and all Solana wallets via Privy
        </p>
      </div>
    </div>
  );
}
