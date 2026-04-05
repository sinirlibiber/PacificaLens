import dynamic from 'next/dynamic';
import ConnectWalletButton from '@/components/ConnectWalletButton';

const GlobeMap = dynamic(() => import('@/components/GlobeMap'), {
  ssr    : false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full" style={{ background: '#060c12' }}>
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-14 h-14 rounded-full border-4 animate-spin"
          style={{ borderColor: 'rgba(0,180,216,0.25)', borderTopColor: '#00b4d8' }}
        />
        <p className="text-sm" style={{ color: '#656d76' }}>Loading globe…</p>
      </div>
    </div>
  ),
});

const FEATURES = [
  { label: 'Analytics & AI' },
  { label: 'Whale Tracker' },
  { label: 'Copy Trading' },
  { label: 'Arbitrage' },
  { label: 'Risk Manager' },
  { label: 'AI Assistant' },
];

export default function Home() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: '#060c12' }}>

      {/* Globe */}
      <div className="absolute inset-0">
        <GlobeMap />
      </div>

      {/* Top bar — logo only */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center px-6 py-4"
        style={{ background: 'linear-gradient(to bottom, rgba(4,8,16,0.9) 0%, transparent 100%)' }}
      >
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="PacificaLens" className="w-8 h-8 object-contain" style={{ filter: 'drop-shadow(0 0 8px rgba(0,212,255,0.6))' }} />
          <span className="font-bold text-base tracking-widest" style={{ color: '#e6edf3', letterSpacing: '0.12em' }}>
            PACIFICALENS
          </span>
        </div>
      </div>

      {/* Bottom CTA */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center pb-6 pt-24"
        style={{ background: 'linear-gradient(to top, rgba(4,8,16,0.97) 0%, rgba(4,8,16,0.6) 60%, transparent 100%)' }}
      >
        {/* Tagline */}
        <p className="text-sm mb-1 font-medium" style={{ color: '#8b949e' }}>
          The all-in-one analytics &amp; trading intelligence for{' '}
          <span style={{ color: '#00d4ff', fontWeight: 700 }}>Pacifica.fi</span>
        </p>

        {/* Feature strip */}
        <div className="flex items-center gap-1 mb-5 mt-2 flex-wrap justify-center px-4">
          {FEATURES.map((f, i) => (
            <div key={f.label} className="flex items-center gap-1">
              <span
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold"
                style={{
                  background: 'rgba(0,180,216,0.08)',
                  border: '1px solid rgba(0,180,216,0.18)',
                  color: 'rgba(160,200,220,0.9)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {f.label}
              </span>
              {i < FEATURES.length - 1 && (
                <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: '10px' }}>·</span>
              )}
            </div>
          ))}
        </div>

        {/* CTA Buttons */}
        <ConnectWalletButton />
        
        <a href="/overview"
          className="mt-3 text-[11px] font-medium transition-colors"
          style={{ color: 'rgba(130,170,190,0.7)' }}
          onMouseOver={e => (e.currentTarget.style.color = 'rgba(0,212,255,0.9)')}
          onMouseOut={e => (e.currentTarget.style.color = 'rgba(130,170,190,0.7)')}>
          Explore without wallet →
        </a>

      </div>

    </div>
  );
}
