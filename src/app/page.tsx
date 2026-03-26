'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const GlobeMap = dynamic(() => import('@/components/GlobeMap'), {
  ssr: false,
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

const STORAGE_KEY = 'pacificalens_access_v1';
type View = 'idle' | 'code' | 'waitlist' | 'waitlist_done';

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>('idle');

  const [code, setCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');

  const [email, setEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'granted') {
      router.replace('/overview');
    }
  }, [router]);

  const handleVerifyCode = useCallback(async () => {
    setCodeError('');
    setCodeLoading(true);
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code }),
      });
      const json = await res.json();
      if (json.valid) {
        localStorage.setItem(STORAGE_KEY, 'granted');
        router.push('/overview');
      } else {
        setCodeError(json.error ?? 'Invalid code');
      }
    } catch {
      setCodeError('Network error, try again');
    } finally {
      setCodeLoading(false);
    }
  }, [code, router]);

  const handleJoinWaitlist = useCallback(async () => {
    setEmailError('');
    setEmailLoading(true);
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', email }),
      });
      const json = await res.json();
      if (json.ok) {
        setView('waitlist_done');
      } else {
        setEmailError(json.error ?? 'Something went wrong');
      }
    } catch {
      setEmailError('Network error, try again');
    } finally {
      setEmailLoading(false);
    }
  }, [email]);

  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: '#060c12' }}>
      <div className="absolute inset-0"><GlobeMap /></div>

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3"
        style={{ background: 'linear-gradient(to bottom, rgba(6,12,18,0.88) 0%, transparent 100%)' }}
      >
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="PacificaLens" className="w-8 h-8 object-contain" />
          <span className="font-bold text-base tracking-widest" style={{ color: '#e6edf3' }}>PACIFICALENS</span>
        </div>
        {view === 'idle' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setView('waitlist')} className="text-sm font-semibold px-4 py-2 rounded-xl" style={{ color: '#8b949e' }}>
              Join Waitlist
            </button>
            <button
              onClick={() => setView('code')}
              className="text-sm font-semibold px-5 py-2 rounded-xl transition-all hover:scale-[1.03] active:scale-100"
              style={{ background: '#00b4d8', color: '#fff', boxShadow: '0 0 18px rgba(0,180,216,0.35)' }}
            >
              I have a code →
            </button>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center pb-10 pt-20"
        style={{ background: 'linear-gradient(to top, rgba(6,12,18,0.95) 0%, transparent 100%)' }}
      >
        <p className="text-sm mb-1" style={{ color: '#8b949e' }}>
          The all-in-one trading intelligence for{' '}
          <span style={{ color: '#e6edf3', fontWeight: 600 }}>Pacifica.fi</span>
        </p>
        <p className="text-xs mb-6" style={{ color: '#656d76' }}>
          Smart leaderboard · Arbitrage scanner · Whale watcher · Risk manager
        </p>

        {view === 'idle' && (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => setView('code')}
              className="text-sm font-semibold px-8 py-3 rounded-xl transition-all hover:scale-[1.03] active:scale-100"
              style={{ background: '#00b4d8', color: '#fff', boxShadow: '0 0 24px rgba(0,180,216,0.4)' }}
            >
              Request Early Access →
            </button>
            <p className="text-[11px]" style={{ color: '#3d444d' }}>Limited spots available</p>
          </div>
        )}

        {view === 'code' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-xs px-4">
            <p className="text-xs" style={{ color: '#8b949e' }}>Enter your invite code</p>
            <input
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-center text-sm font-mono outline-none tracking-widest"
              style={{ background: '#0d1f2d', border: '0.5px solid #1a3346', color: '#e6edf3' }}
              placeholder="XXXXXXXX"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && code && handleVerifyCode()}
              maxLength={16}
            />
            {codeError && <p className="text-xs" style={{ color: '#ef4444' }}>{codeError}</p>}
            <button
              onClick={handleVerifyCode}
              disabled={codeLoading || !code}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: '#00b4d8', color: '#fff', opacity: codeLoading || !code ? 0.5 : 1 }}
            >
              {codeLoading ? 'Verifying…' : 'Enter Dashboard →'}
            </button>
            <button onClick={() => setView('waitlist')} className="text-xs" style={{ color: '#4a7a8a' }}>
              No code? Join the waitlist
            </button>
          </div>
        )}

        {view === 'waitlist' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-xs px-4">
            <p className="text-xs" style={{ color: '#8b949e' }}>
              Drop your email — we'll send your invite when a spot opens.
            </p>
            <input
              autoFocus
              type="email"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: '#0d1f2d', border: '0.5px solid #1a3346', color: '#e6edf3' }}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && email && handleJoinWaitlist()}
            />
            {emailError && <p className="text-xs" style={{ color: '#ef4444' }}>{emailError}</p>}
            <button
              onClick={handleJoinWaitlist}
              disabled={emailLoading || !email}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: '#00b4d8', color: '#fff', opacity: emailLoading || !email ? 0.5 : 1 }}
            >
              {emailLoading ? 'Sending…' : 'Request Access'}
            </button>
            <button onClick={() => setView('code')} className="text-xs" style={{ color: '#4a7a8a' }}>
              Already have a code?
            </button>
          </div>
        )}

        {view === 'waitlist_done' && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: '#e6edf3' }}>You're on the list. 👀</p>
            <p className="text-xs" style={{ color: '#4a7a8a' }}>We'll email your invite code soon.</p>
            <button onClick={() => setView('code')} className="text-xs mt-2" style={{ color: '#00b4d8' }}>
              Already have a code? Enter here
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
