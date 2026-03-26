'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth';
import { fmtShortAddr } from '@/lib/utils';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { updateBuilderFeeRate, getBuilderOverview, BUILDER_WALLET, toBase58 } from '@/lib/pacificaSigning';

type Tab = 'overview' | 'risk' | 'arbitrage' | 'arbitrage-bot' | 'copy' | 'portfolio' | 'analytics';

interface HeaderProps {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  accountInfo?: { balance: string; account_equity: string } | null;
}

function getSolanaAddress(user: ReturnType<typeof usePrivy>['user']): string | null {
  if (!user) return null;
  const accounts = user.linkedAccounts ?? [];
  for (const a of accounts) {
    const acc = a as { type: string; chainType?: string; walletClientType?: string; address?: string };
    if (acc.type === 'wallet' && acc.chainType === 'solana' && acc.address) return acc.address;
  }
  for (const a of accounts) {
    const acc = a as { type: string; walletClientType?: string; address?: string };
    if (acc.type === 'wallet' && ['phantom','solflare','backpack','glow','slope'].includes(acc.walletClientType || '') && acc.address) return acc.address;
  }
  for (const a of accounts) {
    const acc = a as { type: string; address?: string };
    if (acc.type === 'wallet' && acc.address && !acc.address.startsWith('0x') && acc.address.length >= 32) return acc.address;
  }
  for (const a of accounts) {
    const acc = a as { type: string; address?: string };
    if (acc.type === 'wallet' && acc.address) return acc.address;
  }
  return null;
}

export { getSolanaAddress };

const NAV_TABS: { id: Tab; label: string }[] = [
  { id: 'overview',   label: 'Dashboard' },
  { id: 'analytics',  label: 'Analytics & AI' },
  { id: 'risk',       label: 'Risk Manager' },
  { id: 'copy',       label: 'Smart Money' },
  { id: 'portfolio',  label: 'Portfolio' },
];

export function Header({ tab, onTabChange, accountInfo }: HeaderProps) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const solanaAddr = solanaWallets.length > 0 ? solanaWallets[0].address : null;
  const linkedAddr = getSolanaAddress(user);
  const address = solanaAddr || linkedAddr;

  const [showWallet, setShowWallet]   = useState(false);
  const [showArb, setShowArb]         = useState(false);
  const [showAdmin, setShowAdmin]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [adminFeeInput, setAdminFeeInput]   = useState('0.001');
  const [adminStatus, setAdminStatus]       = useState<string | null>(null);
  const [adminOverview, setAdminOverview]   = useState<Record<string, unknown> | null>(null);
  const adminRef  = useRef<HTMLDivElement>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const arbRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (walletRef.current  && !walletRef.current.contains(e.target as Node))  setShowWallet(false);
      if (arbRef.current     && !arbRef.current.contains(e.target as Node))     setShowArb(false);
      if (adminRef.current   && !adminRef.current.contains(e.target as Node))   setShowAdmin(false);
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const equity  = accountInfo ? Number(accountInfo.account_equity || 0) : null;
  const balance = accountInfo ? Number(accountInfo.balance || 0) : null;
  const { isDark, toggle: toggleTheme } = useTheme();
  const isArbActive   = tab === 'arbitrage' || tab === 'arbitrage-bot';
  const isBuilderWallet = address === BUILDER_WALLET;

  return (
    <header
      className="flex items-center h-[60px] border-b sticky top-0 z-50 px-6 gap-6"
      style={{
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(20px) saturate(200%)',
        WebkitBackdropFilter: 'blur(20px) saturate(200%)',
        borderColor: 'var(--border1)',
        boxShadow: '0 1px 0 var(--border1)',
      }}
    >
      {/* ── Logo ── */}
      <a
        href="https://www.pacificalens.xyz/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
      >
        <Image src="/logo.png" alt="PacificaLens" width={32} height={32} className="object-contain" />
        <span className="font-bold text-[15px] tracking-widest uppercase" style={{ color: 'var(--text1)', letterSpacing: '0.12em' }}>
          PACIFICALENS
        </span>
      </a>

      {/* ── Nav Tabs ── */}
      <nav className="flex-1 flex items-center justify-center">
        {authenticated && (
          <div className="flex items-center gap-1">
            {NAV_TABS.map(({ id, label }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => onTabChange(id)}
                  className={[
                    'px-4 py-1.5 text-[13px] font-semibold rounded-lg transition-all duration-150',
                    active
                      ? 'text-accent'
                      : 'text-text2 hover:text-text1',
                  ].join(' ')}
                  style={active ? { color: 'var(--accent)' } : {}}
                >
                  {label}
                </button>
              );
            })}

            {/* Arbitrage dropdown */}
            <div className="relative" ref={arbRef}>
              <button
                onClick={() => setShowArb(v => !v)}
                className={[
                  'px-4 py-1.5 text-[13px] font-semibold rounded-lg transition-all duration-150 flex items-center gap-1',
                  isArbActive ? 'text-accent' : 'text-text2 hover:text-text1',
                ].join(' ')}
                style={isArbActive ? { color: 'var(--accent)' } : {}}
              >
                Arbitrage
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={`transition-transform duration-200 ${showArb ? 'rotate-180' : ''}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {showArb && (
                <div className="absolute top-full left-0 mt-2 w-52 rounded-2xl overflow-hidden z-50 py-1"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border1)', boxShadow: 'var(--shadow-md)' }}>
                  {[
                    { id: 'arbitrage' as Tab,     icon: '📡', title: 'Scanner',       sub: 'Find arb opportunities' },
                    { id: 'arbitrage-bot' as Tab, icon: '🤖', title: 'Arbitrage Bot', sub: 'Telegram · Discord · Alerts' },
                  ].map(item => (
                    <button key={item.id} onClick={() => { setShowArb(false); onTabChange(item.id); }}
                      className="w-full text-left px-4 py-2.5 text-[12px] transition-colors flex items-center gap-3"
                      style={{ color: tab === item.id ? 'var(--accent)' : 'var(--text2)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span className="text-base">{item.icon}</span>
                      <div>
                        <div className="font-semibold">{item.title}</div>
                        <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{item.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ── Right Controls ── */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Notification bell */}
        <button className="w-8 h-8 flex items-center justify-center rounded-lg transition-all relative"
          style={{ color: 'var(--text3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text1)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full dot-live" style={{ background: 'var(--accent)' }} />
        </button>

        {/* Theme toggle */}
        <button onClick={toggleTheme}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
          style={{ color: 'var(--text3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text1)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>

        {/* Settings */}
        <div className="relative" ref={settingsRef}>
          <button onClick={() => setShowSettings(v => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
            style={{
              color: showSettings ? 'var(--accent)' : 'var(--text3)',
              background: showSettings ? 'var(--accent-glow)' : 'transparent',
            }}
            onMouseEnter={e => { if (!showSettings) { (e.currentTarget as HTMLElement).style.color = 'var(--text1)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; } }}
            onMouseLeave={e => { if (!showSettings) { (e.currentTarget as HTMLElement).style.color = 'var(--text3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          {showSettings && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl overflow-hidden z-50"
              style={{ background: 'var(--surface)', border: '1px solid var(--border1)', boxShadow: 'var(--shadow-md)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border1)', background: 'var(--surface2)' }}>
                <div className="text-[12px] font-bold" style={{ color: 'var(--text1)' }}>Settings</div>
              </div>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border1)' }}>
                <div className="text-[10px] uppercase font-semibold tracking-wide mb-2" style={{ color: 'var(--text3)' }}>Appearance</div>
                <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border1)', background: 'var(--surface2)' }}>
                  {[
                    { label: 'Light', dark: false },
                    { label: 'Dark',  dark: true  },
                  ].map(opt => (
                    <button key={opt.label} onClick={() => { if (isDark !== opt.dark) toggleTheme(); }}
                      className="flex-1 py-2 text-[11px] font-semibold transition-all"
                      style={{
                        background: isDark === opt.dark ? 'var(--surface)' : 'transparent',
                        color: isDark === opt.dark ? 'var(--text1)' : 'var(--text3)',
                        boxShadow: isDark === opt.dark ? 'var(--shadow)' : 'none',
                      }}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[10px] uppercase font-semibold tracking-wide mb-2" style={{ color: 'var(--text3)' }}>Notifications</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  {typeof Notification !== 'undefined' ? (Notification.permission === 'granted' ? '✓ Browser notifications enabled' : 'Browser notifications not enabled') : 'Not supported'}
                </div>
                {typeof Notification !== 'undefined' && Notification.permission !== 'granted' && Notification.permission !== 'denied' && (
                  <button onClick={() => Notification.requestPermission()}
                    className="mt-2 text-[11px] font-semibold px-3 py-1 rounded-lg border transition-all"
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-glow)' }}>
                    Enable
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Builder admin */}
        {authenticated && isBuilderWallet && (
          <div className="relative" ref={adminRef}>
            <button onClick={() => { setShowAdmin(v => !v); if (!adminOverview) getBuilderOverview().then(setAdminOverview); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg border transition-all"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-glow)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              </svg>
            </button>
            {showAdmin && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl overflow-hidden z-50"
                style={{ background: 'var(--surface)', border: '1px solid var(--border1)', boxShadow: 'var(--shadow-md)' }}>
                <div className="px-4 py-3 border-b flex items-center justify-between"
                  style={{ borderColor: 'var(--border1)', background: 'var(--surface2)' }}>
                  <div>
                    <div className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--accent)' }}>Builder Admin</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text3)' }}>PACIFICALENS</div>
                  </div>
                  <div className="text-[9px] font-semibold px-2 py-0.5 rounded-full border"
                    style={{ color: 'var(--success)', background: 'var(--success-bg)', borderColor: 'var(--success)' }}>OWNER</div>
                </div>
                {adminOverview && (
                  <div className="px-4 py-3 border-b grid grid-cols-2 gap-2" style={{ borderColor: 'var(--border1)' }}>
                    {[
                      { label: 'Current Fee',   value: adminOverview.fee_rate ? `${(Number(adminOverview.fee_rate) * 100).toFixed(2)}%` : '—' },
                      { label: 'Total Volume',  value: adminOverview.total_volume ? `$${Number(adminOverview.total_volume).toLocaleString()}` : '—' },
                      { label: 'Total Trades',  value: adminOverview.total_trades ? String(adminOverview.total_trades) : '—' },
                      { label: 'Total Earned',  value: adminOverview.total_fees_earned ? `$${Number(adminOverview.total_fees_earned).toLocaleString()}` : '—' },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl px-2.5 py-2" style={{ background: 'var(--surface2)' }}>
                        <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>{s.label}</div>
                        <div className="text-[12px] font-bold mt-0.5" style={{ color: 'var(--text1)' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="px-4 py-3">
                  <div className="text-[10px] uppercase font-semibold tracking-wide mb-2" style={{ color: 'var(--text3)' }}>Update Fee Rate</div>
                  <div className="flex gap-2">
                    <input type="text" value={adminFeeInput} onChange={e => setAdminFeeInput(e.target.value)}
                      placeholder="e.g. 0.001"
                      className="flex-1 rounded-xl px-2.5 py-1.5 text-[11px] font-mono border outline-none"
                      style={{ background: 'var(--surface2)', borderColor: 'var(--border1)', color: 'var(--text1)' }} />
                    <button onClick={async () => {
                      setAdminStatus('Waiting...');
                      const solWallet = solanaWallets.find(w => w.address === address) || solanaWallets[0];
                      const privySign = async (msgBytes: Uint8Array): Promise<string> => {
                        if (solWallet) { const r = await solWallet.signMessage(msgBytes); return typeof r === 'string' ? r : toBase58(r as unknown as Uint8Array); }
                        throw new Error('No Solana wallet');
                      };
                      const result = await updateBuilderFeeRate(adminFeeInput, privySign);
                      setAdminStatus(result.success ? `✓ Updated to ${adminFeeInput}` : `Error: ${result.error}`);
                      if (result.success) getBuilderOverview().then(setAdminOverview);
                    }}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap"
                      style={{ background: 'var(--accent)', color: '#fff' }}>
                      Update
                    </button>
                  </div>
                  {adminStatus && (
                    <div className="mt-2 text-[10px] px-2.5 py-1.5 rounded-xl border"
                      style={adminStatus.startsWith('✓')
                        ? { background: 'var(--success-bg)', color: 'var(--success)', borderColor: 'var(--success)' }
                        : { background: 'var(--danger-bg)', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                      {adminStatus}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Wallet / Connect */}
        {!ready ? (
          <div className="w-24 h-8 rounded-xl animate-pulse" style={{ background: 'var(--surface2)' }} />
        ) : authenticated && address ? (
          <div className="relative" ref={walletRef}>
            <button onClick={() => setShowWallet(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all"
              style={{ background: 'var(--surface2)', borderColor: 'var(--border1)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border1)')}
            >
              <span className="w-1.5 h-1.5 rounded-full dot-live" style={{ background: 'var(--success)', flexShrink: 0 }} />
              <span className="text-[11px] font-mono" style={{ color: 'var(--text2)' }}>{fmtShortAddr(address)}</span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                style={{ color: 'var(--text3)' }} className={`transition-transform ${showWallet ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showWallet && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl overflow-hidden z-50"
                style={{ background: 'var(--surface)', border: '1px solid var(--border1)', boxShadow: 'var(--shadow-md)' }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border1)', background: 'var(--surface2)' }}>
                  <div className="text-[9px] uppercase font-semibold tracking-wide mb-1" style={{ color: 'var(--text3)' }}>Wallet</div>
                  <div className="text-[11px] font-mono break-all" style={{ color: 'var(--text1)' }}>{address}</div>
                  <button onClick={() => navigator.clipboard.writeText(address)}
                    className="text-[10px] mt-1 hover:underline" style={{ color: 'var(--accent)' }}>
                    Copy address
                  </button>
                </div>
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border1)' }}>
                  {[
                    { label: 'Account Equity', value: equity !== null ? '$' + equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—', accent: true },
                    { label: 'Balance',         value: balance !== null ? '$' + balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—', accent: false },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-center mb-2 last:mb-0">
                      <span className="text-[10px] uppercase font-semibold tracking-wide" style={{ color: 'var(--text3)' }}>{row.label}</span>
                      <span className="text-[13px] font-bold" style={{ color: row.accent ? 'var(--accent)' : 'var(--text1)' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 flex flex-col gap-0.5">
                  <a href="https://app.pacifica.fi" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] transition-colors"
                    style={{ color: 'var(--text2)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span>↗</span> Open Pacifica
                  </a>
                  <button onClick={() => { logout(); setShowWallet(false); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] transition-colors text-left"
                    style={{ color: 'var(--danger)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span>⏻</span> Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button onClick={login}
            className="text-[12px] font-bold px-4 py-2 rounded-xl transition-all"
            style={{ background: 'var(--accent)', color: '#fff' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}>
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
