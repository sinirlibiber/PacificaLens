'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const GlobeMap = dynamic(() => import('@/components/GlobeMap'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: '#060c12' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div
          style={{
            width: '48px', height: '48px', borderRadius: '50%',
            border: '3px solid rgba(0,180,216,0.2)',
            borderTopColor: '#00b4d8',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ fontSize: '13px', color: '#656d76', margin: 0 }}>Loading globe…</p>
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
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', overflow: 'hidden', background: '#060c12' }}>

      {/* Globe */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <GlobeMap />
      </div>

      {/* Top bar */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'linear-gradient(to bottom, rgba(6,12,18,0.9) 0%, transparent 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="PacificaLens" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
          <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '3px', color: '#e6edf3' }}>
            PACIFICALENS
          </span>
        </div>
        {view === 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setView('waitlist')}
              style={{ fontSize: '12px', fontWeight: 600, padding: '8px 12px', borderRadius: '10px', border: 'none', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}
            >
              Join Waitlist
            </button>
            <button
              onClick={() => setView('code')}
              style={{
                fontSize: '12px', fontWeight: 600, padding: '8px 14px', borderRadius: '10px', border: 'none',
                background: '#00b4d8', color: '#fff', cursor: 'pointer',
                boxShadow: '0 0 14px rgba(0,180,216,0.35)',
              }}
            >
              I have a code →
            </button>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingBottom: 'max(28px, env(safe-area-inset-bottom, 28px))',
          paddingTop: '64px',
          paddingLeft: '16px', paddingRight: '16px',
          background: 'linear-gradient(to top, rgba(6,12,18,0.96) 0%, transparent 100%)',
        }}
      >
        <p style={{ fontSize: '13px', marginBottom: '4px', color: '#8b949e', textAlign: 'center' }}>
          The all-in-one trading intelligence for{' '}
          <span style={{ color: '#e6edf3', fontWeight: 600 }}>Pacifica.fi</span>
        </p>
        <p style={{ fontSize: '11px', marginBottom: '20px', color: '#656d76', textAlign: 'center' }}>
          Smart leaderboard · Arbitrage scanner · Whale watcher · Risk manager
        </p>

        {/* IDLE */}
        {view === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => setView('code')}
              style={{
                fontSize: '14px', fontWeight: 600, padding: '13px 32px', borderRadius: '12px', border: 'none',
                background: '#00b4d8', color: '#fff', cursor: 'pointer',
                boxShadow: '0 0 20px rgba(0,180,216,0.4)',
              }}
            >
              Request Early Access →
            </button>
            <p style={{ fontSize: '11px', color: '#3d444d', margin: 0 }}>Limited spots available</p>
          </div>
        )}

        {/* CODE */}
        {view === 'code' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '100%', maxWidth: '320px' }}>
            <p style={{ fontSize: '12px', color: '#8b949e', margin: 0 }}>Enter your invite code</p>
            <input
              autoFocus
              style={{
                width: '100%', background: '#0d1f2d', border: '0.5px solid #1a3346', borderRadius: '12px',
                padding: '13px 16px', fontSize: '15px', fontFamily: 'monospace', color: '#e6edf3',
                textAlign: 'center', letterSpacing: '0.2em', outline: 'none', boxSizing: 'border-box',
              }}
              placeholder="XXXXXXXX"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && code && handleVerifyCode()}
              maxLength={16}
            />
            {codeError && <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>{codeError}</p>}
            <button
              onClick={handleVerifyCode}
              disabled={codeLoading || !code}
              style={{
                width: '100%', padding: '13px', borderRadius: '12px', border: 'none',
                background: '#00b4d8', color: '#fff', fontSize: '14px', fontWeight: 600,
                cursor: codeLoading || !code ? 'not-allowed' : 'pointer',
                opacity: codeLoading || !code ? 0.5 : 1,
              }}
            >
              {codeLoading ? 'Verifying…' : 'Enter Dashboard →'}
            </button>
            <button
              onClick={() => setView('waitlist')}
              style={{ fontSize: '12px', color: '#4a7a8a', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              No code? Join the waitlist
            </button>
          </div>
        )}

        {/* WAITLIST */}
        {view === 'waitlist' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '100%', maxWidth: '320px' }}>
            <p style={{ fontSize: '12px', color: '#8b949e', margin: 0, textAlign: 'center' }}>
              Drop your email — we'll send your invite when a spot opens.
            </p>
            <input
              autoFocus
              type="email"
              style={{
                width: '100%', background: '#0d1f2d', border: '0.5px solid #1a3346', borderRadius: '12px',
                padding: '13px 16px', fontSize: '15px', color: '#e6edf3',
                outline: 'none', boxSizing: 'border-box',
              }}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && email && handleJoinWaitlist()}
            />
            {emailError && <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>{emailError}</p>}
            <button
              onClick={handleJoinWaitlist}
              disabled={emailLoading || !email}
              style={{
                width: '100%', padding: '13px', borderRadius: '12px', border: 'none',
                background: '#00b4d8', color: '#fff', fontSize: '14px', fontWeight: 600,
                cursor: emailLoading || !email ? 'not-allowed' : 'pointer',
                opacity: emailLoading || !email ? 0.5 : 1,
              }}
            >
              {emailLoading ? 'Sending…' : 'Request Access'}
            </button>
            <button
              onClick={() => setView('code')}
              style={{ fontSize: '12px', color: '#4a7a8a', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Already have a code?
            </button>
          </div>
        )}

        {/* WAITLIST DONE */}
        {view === 'waitlist_done' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <p style={{ fontSize: '14px', fontWeight: 600, color: '#e6edf3', margin: 0 }}>You're on the list. 👀</p>
            <p style={{ fontSize: '12px', color: '#4a7a8a', margin: 0 }}>We'll email your invite code soon.</p>
            <button
              onClick={() => setView('code')}
              style={{ fontSize: '12px', color: '#00b4d8', background: 'none', border: 'none', cursor: 'pointer', marginTop: '8px' }}
            >
              Already have a code? Enter here
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
