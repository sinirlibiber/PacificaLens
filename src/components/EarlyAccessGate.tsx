'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'pacificalens_access_v1';

function isUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'granted';
}

type View = 'code' | 'waitlist' | 'waitlist_done';

export function EarlyAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('code');

  const [code, setCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');

  const [email, setEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    setUnlocked(isUnlocked());
    setReady(true);
  }, []);

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
        setUnlocked(true);
      } else {
        setCodeError(json.error ?? 'Invalid code');
      }
    } catch {
      setCodeError('Network error, try again');
    } finally {
      setCodeLoading(false);
    }
  }, [code]);

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

  if (!ready) return null;
  if (unlocked || pathname === '/') return <>{children}</>;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        width: '100%',
        background: '#060c12',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="PacificaLens" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
        <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '3px', color: '#e6edf3' }}>
          PACIFICALENS
        </span>
      </div>

      {/* Card */}
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: '#0d1f2d',
          border: '0.5px solid #1a3346',
          borderRadius: '16px',
          padding: '28px 24px',
          boxSizing: 'border-box',
        }}
      >
        {/* Toggle */}
        <div
          style={{
            display: 'flex',
            borderRadius: '8px',
            overflow: 'hidden',
            background: '#060c12',
            marginBottom: '24px',
          }}
        >
          {(['code', 'waitlist'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: view === v ? '#00b4d8' : 'transparent',
                color: view === v ? '#fff' : '#4a7a8a',
                transition: 'all 0.15s',
              }}
            >
              {v === 'code' ? 'I have a code' : 'Join waitlist'}
            </button>
          ))}
        </div>

        {/* Code view */}
        {view === 'code' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '13px', color: '#8b949e', margin: 0, lineHeight: 1.6 }}>
              Enter your invite code to access PacificaLens.
            </p>
            <input
              autoFocus
              style={{
                width: '100%',
                background: '#060c12',
                border: '0.5px solid #1a3346',
                borderRadius: '12px',
                padding: '14px 16px',
                fontSize: '15px',
                fontFamily: 'monospace',
                color: '#e6edf3',
                textAlign: 'center',
                letterSpacing: '0.2em',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              placeholder="XXXXXXXX"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && code && handleVerifyCode()}
              maxLength={16}
            />
            {codeError && (
              <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>{codeError}</p>
            )}
            <button
              onClick={handleVerifyCode}
              disabled={codeLoading || !code}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                background: '#00b4d8',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: codeLoading || !code ? 'not-allowed' : 'pointer',
                opacity: codeLoading || !code ? 0.5 : 1,
              }}
            >
              {codeLoading ? 'Verifying…' : 'Enter Dashboard →'}
            </button>
          </div>
        )}

        {/* Waitlist view */}
        {view === 'waitlist' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '13px', color: '#8b949e', margin: 0, lineHeight: 1.6 }}>
              Drop your email — we'll send your invite when a spot opens.
            </p>
            <input
              autoFocus
              type="email"
              style={{
                width: '100%',
                background: '#060c12',
                border: '0.5px solid #1a3346',
                borderRadius: '12px',
                padding: '14px 16px',
                fontSize: '15px',
                color: '#e6edf3',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && email && handleJoinWaitlist()}
            />
            {emailError && (
              <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>{emailError}</p>
            )}
            <button
              onClick={handleJoinWaitlist}
              disabled={emailLoading || !email}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                background: '#00b4d8',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: emailLoading || !email ? 'not-allowed' : 'pointer',
                opacity: emailLoading || !email ? 0.5 : 1,
              }}
            >
              {emailLoading ? 'Sending…' : 'Request Access'}
            </button>
          </div>
        )}

        {/* Waitlist done */}
        {view === 'waitlist_done' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>👀</div>
            <p style={{ fontSize: '14px', fontWeight: 600, color: '#e6edf3', margin: '0 0 6px' }}>
              You're on the list.
            </p>
            <p style={{ fontSize: '12px', color: '#4a7a8a', margin: '0 0 16px' }}>
              We'll email your invite code soon.
            </p>
            <button
              onClick={() => setView('code')}
              style={{ fontSize: '12px', color: '#00b4d8', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Already have a code?
            </button>
          </div>
        )}
      </div>

      <p style={{ fontSize: '11px', color: '#2d4a5a', marginTop: '24px' }}>
        #Pacifica · #Solana · Early Access
      </p>
    </div>
  );
}
