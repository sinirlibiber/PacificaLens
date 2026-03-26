'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const STORAGE_KEY = 'pacificalens_access_v1';

function isUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'granted';
}

type View = 'code' | 'waitlist' | 'waitlist_done';

export function EarlyAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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

  // Ana sayfa (globe) her zaman görünür — gate sadece diğer sayfalarda devreye girer
  if (!ready) return null;
  if (unlocked || pathname === '/') return <>{children}</>;

  return (
    <div
      className="flex flex-col items-center justify-center w-screen h-screen"
      style={{ background: '#060c12' }}
    >
      <div className="flex items-center gap-2.5 mb-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="PacificaLens" className="w-9 h-9 object-contain" />
        <span className="font-bold text-base tracking-widest" style={{ color: '#e6edf3' }}>
          PACIFICALENS
        </span>
      </div>

      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: '#0d1f2d', border: '0.5px solid #1a3346' }}
      >
        {/* Toggle */}
        <div className="flex rounded-lg overflow-hidden mb-6" style={{ background: '#060c12' }}>
          {(['code', 'waitlist'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="flex-1 py-2 text-sm font-semibold transition-all"
              style={{
                background: view === v ? '#00b4d8' : 'transparent',
                color: view === v ? '#fff' : '#4a7a8a',
              }}
            >
              {v === 'code' ? 'I have a code' : 'Join waitlist'}
            </button>
          ))}
        </div>

        {/* Code view */}
        {view === 'code' && (
          <>
            <p className="text-sm mb-4" style={{ color: '#8b949e' }}>
              Enter your invite code to access PacificaLens.
            </p>
            <input
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-center text-sm font-mono mb-3 outline-none tracking-widest"
              style={{ background: '#060c12', border: '0.5px solid #1a3346', color: '#e6edf3' }}
              placeholder="XXXXXXXX"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && code && handleVerifyCode()}
              maxLength={16}
            />
            {codeError && <p className="text-xs mb-3" style={{ color: '#ef4444' }}>{codeError}</p>}
            <button
              onClick={handleVerifyCode}
              disabled={codeLoading || !code}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: '#00b4d8', color: '#fff', opacity: codeLoading || !code ? 0.5 : 1 }}
            >
              {codeLoading ? 'Verifying…' : 'Enter Dashboard →'}
            </button>
          </>
        )}

        {/* Waitlist view */}
        {view === 'waitlist' && (
          <>
            <p className="text-sm mb-4" style={{ color: '#8b949e' }}>
              Drop your email — we'll send your invite when a spot opens.
            </p>
            <input
              autoFocus
              type="email"
              className="w-full rounded-xl px-4 py-3 text-sm mb-3 outline-none"
              style={{ background: '#060c12', border: '0.5px solid #1a3346', color: '#e6edf3' }}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && email && handleJoinWaitlist()}
            />
            {emailError && <p className="text-xs mb-3" style={{ color: '#ef4444' }}>{emailError}</p>}
            <button
              onClick={handleJoinWaitlist}
              disabled={emailLoading || !email}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: '#00b4d8', color: '#fff', opacity: emailLoading || !email ? 0.5 : 1 }}
            >
              {emailLoading ? 'Sending…' : 'Request Access'}
            </button>
          </>
        )}

        {/* Waitlist done */}
        {view === 'waitlist_done' && (
          <div className="text-center py-4">
            <div className="text-2xl mb-3">👀</div>
            <p className="text-sm font-semibold mb-1" style={{ color: '#e6edf3' }}>You're on the list.</p>
            <p className="text-xs mb-4" style={{ color: '#4a7a8a' }}>
              We'll email your invite code soon.
            </p>
            <button onClick={() => setView('code')} className="text-xs" style={{ color: '#00b4d8' }}>
              Already have a code?
            </button>
          </div>
        )}
      </div>

      <p className="text-xs mt-6" style={{ color: '#2d4a5a' }}>
        #Pacifica · #Solana · Early Access
      </p>
    </div>
  );
}
