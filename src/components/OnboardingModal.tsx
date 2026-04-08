'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'pacificalens_onboarding_v1';

const SLIDES = [
  {
    icon: '🌊',
    title: 'Welcome to PacificaLens',
    subtitle: 'Your trading intelligence layer for Pacifica.fi',
    body: 'PacificaLens is an all-in-one analytics and trading dashboard built exclusively for the Pacifica perpetual DEX on Solana. Get real-time market data, track smart money, and trade smarter.',
    badge: null,
  },
  {
    icon: '💧',
    title: 'Liquidation Monitor',
    subtitle: 'Track liquidations across 60+ markets',
    body: 'Monitor estimated liquidation volumes from HyperLiquid and Pacifica DEX in real time. Includes HIP-3 external markets like SP500, Gold, Crude Oil, TSLA, NVDA and more — unique to PacificaLens.',
    badge: 'NEW',
  },
  {
    icon: '🏆',
    title: 'AlphaBoard',
    subtitle: 'Follow the best traders on Pacifica',
    body: 'Browse 7,000+ traders ranked by our 8-dimension scoring system. Click any trader to view their open positions and copy their trades manually — or enable Auto Copy Trading with a Pacifica Agent Key for fully automatic mirroring.',
    badge: null,
  },
  {
    icon: '📊',
    title: 'Analytics & AI',
    subtitle: 'Market signals, funding rates, OI distribution',
    body: 'Real-time market signals detect OI spikes and funding anomalies. The AI Assistant answers your market questions. Track funding rates, long/short ratios, and liquidation heatmaps across all Pacifica markets.',
    badge: null,
  },
  {
    icon: '🚀',
    title: "You're all set",
    subtitle: 'Explore PacificaLens',
    body: 'Connect your Solana wallet to access trading, copy trading, and personal portfolio features. Or continue as a guest to explore market data freely.',
    badge: null,
  },
];

export default function OnboardingModal() {
  const [visible, setVisible] = useState(false);
  const [slide, setSlide] = useState(0);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setVisible(true);
  }, []);

  const close = (dontShow = false) => {
    setClosing(true);
    if (dontShow) localStorage.setItem(STORAGE_KEY, '1');
    setTimeout(() => { setVisible(false); setClosing(false); }, 300);
  };

  const next = () => {
    if (slide < SLIDES.length - 1) setSlide(s => s + 1);
    else close(true);
  };

  const prev = () => { if (slide > 0) setSlide(s => s - 1); };

  if (!visible) return null;

  const current = SLIDES[slide];
  const isLast = slide === SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(12px)',
        opacity: closing ? 0 : 1,
        transition: 'opacity 0.3s ease',
      }}
      onClick={e => { if (e.target === e.currentTarget) close(false); }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: 520,
          maxWidth: '94vw',
          background: 'linear-gradient(135deg, #060c18 0%, #0a1628 100%)',
          border: '1px solid rgba(0,180,216,0.2)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(0,180,216,0.08)',
          transform: closing ? 'scale(0.96)' : 'scale(1)',
          transition: 'transform 0.3s ease',
        }}
      >
        {/* Top accent line */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #00b4d8, #00d4c8, transparent)' }} />

        {/* Header with logo */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="PacificaLens" className="w-7 h-7 object-contain"
              style={{ filter: 'drop-shadow(0 0 8px rgba(0,180,216,0.6))' }} />
            <span className="text-[11px] font-bold tracking-widest"
              style={{ color: 'rgba(0,180,216,0.8)', letterSpacing: '0.15em' }}>PACIFICALENS</span>
            {current.badge && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(0,210,200,0.15)', color: '#00d4c8', border: '1px solid rgba(0,210,200,0.3)' }}>
                {current.badge}
              </span>
            )}
          </div>
          <button onClick={() => close(false)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[14px] transition-opacity hover:opacity-60"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)' }}>
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-4 flex-1">
          {/* Icon */}
          <div className="flex items-center justify-center mb-5 mt-2">
            <div className="text-[52px]" style={{ filter: 'drop-shadow(0 0 20px rgba(0,180,216,0.3))' }}>
              {current.icon}
            </div>
          </div>

          {/* Text */}
          <div className="text-center">
            <h2 className="text-[20px] font-bold mb-1.5" style={{ color: 'rgba(255,255,255,0.92)' }}>
              {current.title}
            </h2>
            <p className="text-[12px] font-semibold mb-4" style={{ color: '#00b4d8' }}>
              {current.subtitle}
            </p>
            <p className="text-[12px] leading-relaxed mx-auto" style={{ color: 'rgba(255,255,255,0.55)', maxWidth: 380 }}>
              {current.body}
            </p>
          </div>

          {/* Last slide CTA buttons */}
          {isLast && (
            <div className="flex gap-3 mt-6 justify-center">
              <a href="/"
                className="px-5 py-2.5 rounded-xl text-[12px] font-bold transition-all hover:opacity-90"
                style={{ background: '#00b4d8', color: '#fff', boxShadow: '0 0 20px rgba(0,180,216,0.3)' }}
                onClick={() => close(true)}>
                Connect Wallet
              </a>
              <a href="/overview"
                className="px-5 py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
                onClick={() => close(true)}>
                Continue as Guest →
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Skip */}
          <button onClick={() => close(true)}
            className="text-[11px] transition-opacity hover:opacity-80 flex items-center gap-1.5"
            style={{ color: 'rgba(255,255,255,0.3)' }}>
            Skip ⏭
          </button>

          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)}
                style={{
                  width: i === slide ? 20 : 6, height: 6,
                  borderRadius: 3,
                  background: i === slide ? '#00b4d8' : 'rgba(255,255,255,0.15)',
                  transition: 'all 0.3s ease',
                  border: 'none',
                  cursor: 'pointer',
                }} />
            ))}
          </div>

          {/* Prev / Next */}
          <div className="flex items-center gap-2">
            {slide > 0 && (
              <button onClick={prev}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                ← Back
              </button>
            )}
            {!isLast && (
              <button onClick={next}
                className="px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-90"
                style={{ background: '#00b4d8', color: '#fff', boxShadow: '0 0 15px rgba(0,180,216,0.3)' }}>
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
