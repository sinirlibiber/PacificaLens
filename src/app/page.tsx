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

export default function Home() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: '#060c12' }}>

      {/* Globe */}
      <div className="absolute inset-0">
        <GlobeMap />
      </div>

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3"
        style={{ background: 'linear-gradient(to bottom, rgba(6,12,18,0.88) 0%, transparent 100%)' }}
      >
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="PacificaLens" className="w-8 h-8 object-contain" />
          <span className="font-bold text-base tracking-widest" style={{ color: '#e6edf3' }}>
            PACIFICALENS
          </span>
        </div>
        <a
          href="/overview"
          className="text-sm font-semibold px-5 py-2 rounded-xl transition-all
                     hover:scale-[1.03] active:scale-100"
          style={{ background: '#00b4d8', color: '#fff', boxShadow: '0 0 18px rgba(0,180,216,0.35)' }}
        >
          Enter Dashboard →
        </a>
      </div>

      {/* Bottom CTA */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center pb-8 pt-20"
        style={{ background: 'linear-gradient(to top, rgba(6,12,18,0.92) 0%, transparent 100%)' }}
      >
        <p className="text-sm mb-1" style={{ color: '#8b949e' }}>
          The all-in-one analytics &amp; trading assistant for{' '}
          <span style={{ color: '#e6edf3', fontWeight: 600 }}>Pacifica.fi</span>
        </p>
        <p className="text-xs mb-5" style={{ color: '#656d76' }}>
          Copy top traders · Scan arbitrage · Track whales · Manage risk
        </p>

        <ConnectWalletButton />

        <p className="text-[11px] mt-4" style={{ color: '#3d444d' }}>
          Supports Phantom, Solflare, Backpack and all Solana wallets via Privy
        </p>
      </div>

    </div>
  );
}
