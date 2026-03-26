'use client';

import { usePrivy } from '@privy-io/react-auth';
import Image from 'next/image';

const FEATURES = [
  { label: 'Smart Money',      desc: 'Follow top traders on Pacifica. Copy positions in one click with custom leverage, SL & TP.', icon: '🔁', colorVar: 'var(--accent)'   },
  { label: 'Risk Manager',     desc: 'Position calculator with liquidation price, risk/reward ratio, and portfolio heat map.',      icon: '🛡️', colorVar: 'var(--success)' },
  { label: 'Arbitrage Scanner',desc: 'Real-time funding rate spread across Hyperliquid, dYdX, Aster and Pacifica.',               icon: '⚡', colorVar: 'var(--warn)'    },
  { label: 'Whale Tracker',    desc: 'Monitor smart money positions and liquidation events across all Pacifica markets.',          icon: '🐋', colorVar: 'var(--accent)'   },
  { label: 'Market Overview',  desc: 'Live charts, orderbook, funding rates, Fear & Greed index, top gainers and losers.',        icon: '📊', colorVar: 'var(--success)' },
  { label: 'Portfolio & Journal',desc:'Track positions, trade history, funding, copy performance and log your trades.',           icon: '📋', colorVar: 'var(--warn)'    },
];

export function ConnectScreen() {
  const { login } = usePrivy();

  return (
    <div className="relative flex flex-col items-center justify-center min-h-full overflow-auto px-4 py-12"
      style={{ background: 'var(--bg)' }}>

      {/* Background grid */}
      <div className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(var(--border1) 1px, transparent 1px), linear-gradient(90deg, var(--border1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          opacity: 0.5,
        }}
      />

      {/* Glow blob */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] rounded-full blur-[140px]"
        style={{ background: 'var(--accent)', opacity: 0.07 }}
      />

      <div className="relative z-10 flex flex-col items-center text-center max-w-2xl w-full">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-5">
          <Image src="/logo.png" alt="PacificaLens" width={56} height={56} className="object-contain" />
          <span className="font-bold text-[30px] tracking-widest" style={{ color: 'var(--text1)', letterSpacing: '0.12em' }}>PACIFICALENS</span>
        </div>

        {/* Tagline */}
        <p className="text-[16px] leading-relaxed max-w-lg mb-2" style={{ color: 'var(--text2)' }}>
          The all-in-one analytics & trading assistant for{' '}
          <span className="font-bold" style={{ color: 'var(--text1)' }}>Pacifica DEX</span>
        </p>
        <p className="text-[13px] mb-8 max-w-md" style={{ color: 'var(--text3)' }}>
          Copy top traders · Scan arbitrage · Track whales · Manage risk — all in one place, directly on-chain.
        </p>

        {/* Hackathon badge */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border text-[11px] font-semibold mb-8"
          style={{ background: 'var(--accent-glow)', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
          <span>🏆</span>
          <span>Pacifica Hackathon 2026 · Built with Pacifica Builder API</span>
        </div>

        {/* CTA */}
        <button onClick={login}
          className="px-8 py-3.5 font-bold text-[14px] rounded-2xl transition-all mb-12"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 0 24px var(--accent-glow)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent2)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}>
          Connect Wallet to Start
        </button>

        {/* Feature grid */}
        <div className="grid grid-cols-3 gap-3 w-full mb-10">
          {FEATURES.map(f => (
            <div key={f.label}
              className="flex flex-col gap-2.5 p-4 rounded-2xl border text-left transition-all"
              style={{ background: 'var(--surface)', borderColor: 'var(--border1)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = f.colorVar)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border1)')}>
              <div className="text-[20px]">{f.icon}</div>
              <div>
                <div className="text-[12px] font-bold mb-1" style={{ color: f.colorVar }}>{f.label}</div>
                <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text3)' }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 w-full rounded-2xl p-4 mb-8"
          style={{ background: 'var(--surface)', border: '1px solid var(--border1)' }}>
          {[
            { value: '6',    label: 'Modules' },
            { value: '5',    label: 'Exchanges Monitored' },
            { value: '100%', label: 'On-chain Execution' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-[24px] font-bold" style={{ color: 'var(--accent)' }}>{s.value}</div>
              <div className="text-[11px]" style={{ color: 'var(--text3)' }}>{s.label}</div>
            </div>
          ))}
        </div>

        <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
          Supports Phantom, Solflare, Backpack and all Solana wallets via Privy
        </p>
      </div>
    </div>
  );
}
