import dynamic from 'next/dynamic';
import ConnectWalletButton from '@/components/ConnectWalletButton';

const GlobeMap = dynamic(() => import('@/components/GlobeMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full" style={{ background: '#060c12' }}>
      <div className="w-14 h-14 rounded-full border-4 animate-spin"
        style={{ borderColor: 'rgba(0,180,216,0.15)', borderTopColor: '#00b4d8' }} />
    </div>
  ),
});

const FEATURES = [
  { icon: '📊', label: 'Analytics & AI',     desc: 'Market signals, funding rates, AI assistant' },
  { icon: '💧', label: 'Liquidation Monitor', desc: 'Real-time liq data across 60+ markets' },
  { icon: '🏆', label: 'AlphaBoard',          desc: 'Track & copy top Pacifica traders' },
  { icon: '⚡', label: 'Arbitrage Scanner',   desc: 'Cross-exchange funding opportunities' },
  { icon: '🛡️', label: 'Risk Manager',        desc: 'Position sizing & risk calculator' },
  { icon: '🤖', label: 'AI Assistant',        desc: 'Ask anything about the markets' },
];

export default function Home() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: '#040810' }}>

      {/* Globe — full background */}
      <div className="absolute inset-0 opacity-80">
        <GlobeMap />
      </div>

      {/* Dark vignette overlay */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 30%, rgba(4,8,16,0.7) 100%)',
      }} />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-8 py-5"
        style={{ background: 'linear-gradient(to bottom, rgba(4,8,16,0.85) 0%, transparent 100%)' }}>
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="PacificaLens" className="w-8 h-8 object-contain"
            style={{ filter: 'drop-shadow(0 0 10px rgba(0,180,216,0.8))' }} />
          <span className="font-bold text-[15px]"
            style={{ color: '#e6edf3', letterSpacing: '0.14em' }}>PACIFICALENS</span>
        </div>
        <a href="https://pacifica.fi" target="_blank" rel="noopener noreferrer"
          className="text-[11px] font-semibold transition-opacity hover:opacity-80"
          style={{ color: 'rgba(0,180,216,0.7)' }}>
          Built for Pacifica.fi ↗
        </a>
      </div>

      {/* Center content */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center"
        style={{ paddingTop: '60px' }}>

        {/* Badge */}
        <div className="mb-4 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
          style={{
            background: 'rgba(0,180,216,0.1)',
            border: '1px solid rgba(0,180,216,0.25)',
            color: '#00b4d8',
            backdropFilter: 'blur(8px)',
          }}>
          Trading Intelligence Dashboard
        </div>

        {/* Main heading */}
        <h1 className="text-center font-bold leading-tight mb-3"
          style={{ fontSize: 'clamp(28px, 5vw, 48px)', color: '#fff',
            textShadow: '0 0 40px rgba(0,180,216,0.3)' }}>
          See the Market.<br />
          <span style={{ color: '#00b4d8' }}>Trade Smarter.</span>
        </h1>

        <p className="text-center mb-8 max-w-md"
          style={{ color: 'rgba(160,200,220,0.7)', fontSize: '13px', lineHeight: 1.6 }}>
          The all-in-one analytics & trading intelligence platform built exclusively for{' '}
          <span style={{ color: '#00d4ff', fontWeight: 700 }}>Pacifica.fi</span> perpetuals.
        </p>

        {/* CTA */}
        <ConnectWalletButton />
      </div>

      {/* Bottom feature cards */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pb-5"
        style={{ background: 'linear-gradient(to top, rgba(4,8,16,0.97) 0%, rgba(4,8,16,0.7) 60%, transparent 100%)' }}>

        {/* Feature cards */}
        <div className="flex items-end justify-center gap-2 px-4 mb-4 overflow-x-auto">
          {FEATURES.map((f) => (
            <div key={f.label}
              className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl shrink-0 transition-all hover:scale-105 cursor-default"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(0,180,216,0.12)',
                backdropFilter: 'blur(16px)',
                minWidth: 110,
              }}>
              <span className="text-[20px]">{f.icon}</span>
              <span className="text-[11px] font-bold text-center leading-tight"
                style={{ color: 'rgba(220,240,255,0.9)' }}>{f.label}</span>
              <span className="text-[9px] text-center leading-tight"
                style={{ color: 'rgba(160,200,220,0.5)' }}>{f.desc}</span>
            </div>
          ))}
        </div>

        {/* Bottom strip */}
        <div className="flex items-center justify-center gap-6 text-[10px]"
          style={{ color: 'rgba(255,255,255,0.2)' }}>
          <span>HyperLiquid Data</span>
          <span>·</span>
          <span>Pacifica DEX</span>
          <span>·</span>
          <span>Solana</span>
          <span>·</span>
          <span>60+ Markets</span>
        </div>
      </div>

    </div>
  );
}
