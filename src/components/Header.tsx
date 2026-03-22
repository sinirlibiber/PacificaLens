'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth';
import { fmtShortAddr } from '@/lib/utils';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { updateBuilderFeeRate, getBuilderOverview, BUILDER_WALLET, toBase58 } from '@/lib/pacificaSigning';

type Tab = 'overview' | 'risk' | 'arbitrage' | 'arbitrage-bot' | 'whale' | 'copy' | 'portfolio' | 'trade';

interface HeaderProps {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  accountInfo?: { balance: string; account_equity: string } | null;
}

function getSolanaAddress(user: ReturnType<typeof usePrivy>['user']): string | null {
  if (!user) return null;
  const accounts = user.linkedAccounts ?? [];

  // Priority 1: explicit Solana chainType
  for (const a of accounts) {
    const acc = a as { type: string; chainType?: string; walletClientType?: string; address?: string };
    if (acc.type === 'wallet' && acc.chainType === 'solana' && acc.address) return acc.address;
  }

  // Priority 2: known Solana wallet clients
  for (const a of accounts) {
    const acc = a as { type: string; walletClientType?: string; address?: string };
    if (acc.type === 'wallet' && ['phantom','solflare','backpack','glow','slope'].includes(acc.walletClientType || '') && acc.address) return acc.address;
  }

  // Priority 3: any non-0x address (Solana addresses are base58, no 0x prefix)
  for (const a of accounts) {
    const acc = a as { type: string; address?: string };
    if (acc.type === 'wallet' && acc.address && !acc.address.startsWith('0x') && acc.address.length >= 32) return acc.address;
  }

  // Fallback: return whatever wallet address exists (even EVM) — better than nothing
  for (const a of accounts) {
    const acc = a as { type: string; address?: string };
    if (acc.type === 'wallet' && acc.address) return acc.address;
  }

  return null;
}

export { getSolanaAddress };

export function Header({ tab, onTabChange, accountInfo }: HeaderProps) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  // Check both sources - useSolanaWallets and linkedAccounts
  const solanaAddr = solanaWallets.length > 0 ? solanaWallets[0].address : null;
  const linkedAddr = getSolanaAddress(user);
  const address = solanaAddr || linkedAddr;
  const [showWallet, setShowWallet] = useState(false);
  const [showArb, setShowArb] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [adminFeeInput, setAdminFeeInput] = useState('0.001');
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [adminOverview, setAdminOverview] = useState<Record<string, unknown> | null>(null);
  const adminRef = useRef<HTMLDivElement>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const arbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (walletRef.current && !walletRef.current.contains(e.target as Node)) setShowWallet(false);
      if (arbRef.current && !arbRef.current.contains(e.target as Node)) setShowArb(false);
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) setShowAdmin(false);
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const equity = accountInfo ? Number(accountInfo.account_equity || 0) : null;
  const balance = accountInfo ? Number(accountInfo.balance || 0) : null;
  const { isDark, toggle: toggleTheme } = useTheme();
  const isArbActive = tab === 'arbitrage' || tab === 'arbitrage-bot';
  const isBuilderWallet = address === BUILDER_WALLET;

  return (
    <header className="flex items-center h-12 border-b border-border1 bg-surface shadow-card sticky top-0 z-50 px-4">
      {/* Logo */}
      <div className="flex items-center gap-2 w-52 shrink-0">
        <Image src="/pacificalens.ico" alt="PacificaLens" width={40} height={40} className="object-contain" />
        <div className="font-bold text-[17px] tracking-tight text-text1 leading-none">PACIFICALENS</div>
      </div>

      {/* Tabs center */}
      <div className="flex-1 flex items-center justify-center">
        {authenticated && (
          <div className="flex items-center bg-surface2 rounded-lg p-0.5 border border-border1 gap-0">

            {/* Overview */}
            <button onClick={() => onTabChange('overview')}
              className={'px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ' +
                (tab === 'overview' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2')}>
              Overview
            </button>

            {/* Risk Manager */}
            <button onClick={() => onTabChange('risk')}
              className={'px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ' +
                (tab === 'risk' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2')}>
              Risk Manager
            </button>

            {/* Arbitrage click dropdown */}
            <div className="relative" ref={arbRef}>
              <button
                onClick={() => setShowArb(v => !v)}
                className={'px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all flex items-center gap-1 ' +
                (isArbActive ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2')}>
                Arbitrage
                <span className={'text-[9px] opacity-60 transition-transform ' + (showArb ? 'rotate-180' : '')}>▾</span>
              </button>

              {showArb && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-surface border border-border1 rounded-xl shadow-card-md z-50 overflow-hidden py-1">
                  <button
                    onClick={() => { setShowArb(false); onTabChange('arbitrage'); }}
                    className={'w-full text-left px-4 py-2.5 text-[12px] font-semibold transition-colors flex items-center gap-2.5 ' +
                      (tab === 'arbitrage' ? 'bg-accent/8 text-accent' : 'text-text2 hover:bg-surface2')}>
                    <span className="text-base">📡</span>
                    <div>
                      <div>Scanner</div>
                      <div className="text-[10px] font-normal text-text3">Find arb opportunities</div>
                    </div>
                  </button>
                  <div className="h-px bg-border1 mx-3 my-0.5" />
                  <button
                    onClick={() => { setShowArb(false); onTabChange('arbitrage-bot'); }}
                    className={'w-full text-left px-4 py-2.5 text-[12px] font-semibold transition-colors flex items-center gap-2.5 ' +
                      (tab === 'arbitrage-bot' ? 'bg-accent/8 text-accent' : 'text-text2 hover:bg-surface2')}>
                    <span className="text-base">🤖</span>
                    <div>
                      <div>Arbitrage Bot</div>
                      <div className="text-[10px] font-normal text-text3">Telegram · Discord · Alerts</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Whale Watch */}
            <button onClick={() => onTabChange('whale')}
              className={'px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ' +
                (tab === 'whale' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2')}>
              Smart Money
            </button>

            {/* Copy Trading */}
            <button onClick={() => onTabChange('copy')}
              className={'px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ' +
                (tab === 'copy' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2')}>
              Copy
            </button>

            {/* Portfolio */}
            <button onClick={() => onTabChange('portfolio')}
              className={'px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ' +
                (tab === 'portfolio' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2')}>
              Portfolio
            </button>

            {/* Trade */}
            <button onClick={() => onTabChange('trade')}
              className={'px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ' +
                (tab === 'trade' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2')}>
              Trade
            </button>

          </div>
        )}
      </div>

      {/* Wallet */}
      <div className="flex items-center gap-2 w-52 justify-end shrink-0">
        {/* Builder Admin — only visible when builder wallet is connected */}
        {authenticated && isBuilderWallet && (
          <div className="relative" ref={adminRef}>
            <button
              onClick={() => {
                setShowAdmin(v => !v);
                if (!adminOverview) getBuilderOverview().then(setAdminOverview);
              }}
              title="Builder Admin"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-accent/40 hover:border-accent hover:bg-accent/5 transition-all text-accent"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              </svg>
            </button>

            {showAdmin && (
              <div className="absolute right-0 top-full mt-1.5 w-72 bg-surface border border-border1 rounded-xl shadow-card-md z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-accent tracking-wide">Builder Admin</div>
                    <div className="text-[10px] text-text3 font-mono mt-0.5">PACIFICALENS</div>
                  </div>
                  <div className="text-[9px] text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded-full font-semibold">OWNER</div>
                </div>

                {/* Current stats from overview */}
                {adminOverview && (
                  <div className="px-4 py-3 border-b border-border1 grid grid-cols-2 gap-2">
                    {[
                      { label: 'Current Fee', value: adminOverview.fee_rate ? `${(Number(adminOverview.fee_rate) * 100).toFixed(2)}%` : '—' },
                      { label: 'Total Volume', value: adminOverview.total_volume ? `$${Number(adminOverview.total_volume).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—' },
                      { label: 'Total Trades', value: adminOverview.total_trades ? String(adminOverview.total_trades) : '—' },
                      { label: 'Total Earned', value: adminOverview.total_fees_earned ? `$${Number(adminOverview.total_fees_earned).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—' },
                    ].map(s => (
                      <div key={s.label} className="bg-surface2 rounded-lg px-2.5 py-2">
                        <div className="text-[9px] text-text3 uppercase tracking-wide">{s.label}</div>
                        <div className="text-[12px] font-bold text-text1 mt-0.5">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Update fee rate */}
                <div className="px-4 py-3">
                  <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-2">Update Fee Rate</div>
                  <div className="text-[10px] text-text3 mb-3 leading-relaxed">
                    Your builder config fee_rate: <span className="text-text1 font-mono">0.001000000000</span> (0.1%).<br/>
                    Users must set <span className="font-mono text-accent">max_fee_rate ≥ fee_rate</span> when approving.
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={adminFeeInput}
                      onChange={e => setAdminFeeInput(e.target.value)}
                      placeholder="e.g. 0.001"
                      className="flex-1 bg-surface2 border border-border1 rounded-lg px-2.5 py-1.5 text-[11px] text-text1 font-mono focus:border-accent outline-none"
                    />
                    <button
                      onClick={async () => {
                        setAdminStatus('Waiting for signature...');
                        const solWallet = solanaWallets.find(w => w.address === address) || solanaWallets[0];
                        const privySign = async (msgBytes: Uint8Array): Promise<string> => {
                          if (solWallet) {
                            const r = await solWallet.signMessage(msgBytes);
                            return typeof r === 'string' ? r : toBase58(r as unknown as Uint8Array);
                          }
                          throw new Error('No Solana wallet');
                        };
                        const result = await updateBuilderFeeRate(adminFeeInput, privySign);
                        setAdminStatus(result.success
                          ? `✓ Fee rate updated to ${adminFeeInput}`
                          : `Error: ${result.error}`
                        );
                        if (result.success) getBuilderOverview().then(setAdminOverview);
                      }}
                      className="bg-accent text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:bg-accent2 transition-colors whitespace-nowrap"
                    >
                      Update
                    </button>
                  </div>
                  {adminStatus && (
                    <div className={`mt-2 text-[10px] px-2.5 py-1.5 rounded-lg border ${
                      adminStatus.startsWith('✓')
                        ? 'bg-success/8 text-success border-success/20'
                        : adminStatus.startsWith('Error')
                        ? 'bg-danger/8 text-danger border-danger/20'
                        : 'bg-accent/8 text-accent border-accent/20'
                    }`}>{adminStatus}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings gear */}
        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => setShowSettings(v => !v)}
            title="Settings"
            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all ${showSettings ? 'border-accent bg-accent/5 text-accent' : 'border-border1 hover:border-accent hover:bg-surface2 text-text2 hover:text-accent'}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          {showSettings && (
            <div className="absolute right-0 top-full mt-1.5 w-64 bg-surface border border-border1 rounded-xl shadow-card-md z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border1 bg-surface2">
                <div className="text-[12px] font-bold text-text1">Settings</div>
              </div>

              {/* Theme */}
              <div className="px-4 py-3 border-b border-border1">
                <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-2">Appearance</div>
                <div className="flex bg-surface2 border border-border1 rounded-lg overflow-hidden">
                  <button onClick={() => { if (isDark) toggleTheme(); }}
                    className={`flex-1 py-2 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all ${!isDark ? 'bg-white text-text1 shadow-sm' : 'text-text3 hover:text-text2'}`}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>
                    Light
                  </button>
                  <button onClick={() => { if (!isDark) toggleTheme(); }}
                    className={`flex-1 py-2 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all ${isDark ? 'bg-surface text-text1 shadow-sm' : 'text-text3 hover:text-text2'}`}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    Dark
                  </button>
                </div>
              </div>

              {/* Price Alerts shortcut */}
              <div className="px-4 py-3 border-b border-border1">
                <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-2">Price Alerts</div>
                <button onClick={() => { onTabChange('portfolio'); setShowSettings(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 transition-all group">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px]">🔔</span>
                    <div className="text-left">
                      <div className="text-[11px] font-semibold text-text1">Manage Alerts</div>
                      <div className="text-[9px] text-text3">Set price notifications</div>
                    </div>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text3 group-hover:text-accent transition-colors"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
              </div>

              {/* Notification permission */}
              <div className="px-4 py-3">
                <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-2">Notifications</div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-text1">Browser Notifications</div>
                    <div className="text-[9px] text-text3 mt-0.5">
                      {typeof Notification !== 'undefined' ? (Notification.permission === 'granted' ? '✓ Enabled' : Notification.permission === 'denied' ? '✗ Blocked in browser' : 'Not enabled yet') : 'Not supported'}
                    </div>
                  </div>
                  {typeof Notification !== 'undefined' && Notification.permission !== 'denied' && (
                    <button
                      onClick={async () => { await Notification.requestPermission(); setShowSettings(false); }}
                      className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${Notification.permission === 'granted' ? 'border-success/30 text-success bg-success/8' : 'border-accent/30 text-accent hover:bg-accent/10'}`}>
                      {Notification.permission === 'granted' ? 'Active' : 'Enable'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        {!ready ? (
          <div className="w-20 h-7 rounded-lg bg-surface2 animate-pulse" />
        ) : authenticated && address ? (
          <div className="relative" ref={walletRef}>
            <button onClick={() => setShowWallet(v => !v)}
              className="flex items-center gap-1.5 bg-surface2 border border-border1 px-2.5 py-1 rounded-lg hover:border-accent/40 transition-all">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-[11px] text-text2 font-mono">{fmtShortAddr(address)}</span>
              <span className="text-[10px] text-text3 ml-0.5">▾</span>
            </button>

            {showWallet && (
              <div className="absolute right-0 top-full mt-1.5 w-64 bg-surface border border-border1 rounded-xl shadow-card-md z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border1 bg-surface2">
                  <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1">Wallet Address</div>
                  <div className="text-[11px] font-mono text-text1 break-all">{address}</div>
                  <button onClick={() => navigator.clipboard.writeText(address)} className="text-[10px] text-accent mt-1 hover:underline">
                    Copy address
                  </button>
                  {address.startsWith('0x') && (
                    <div className="mt-2 text-[10px] text-warn bg-warn/8 border border-warn/20 rounded-lg px-2 py-1.5 leading-relaxed">
                      ⚠ EVM wallet detected. Connect Phantom or Solflare for Pacifica trading.
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 border-b border-border1">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] text-text3 uppercase font-semibold tracking-wide">Account Equity</span>
                    <span className="text-[13px] font-bold text-accent">
                      {equity !== null ? '$' + equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-text3 uppercase font-semibold tracking-wide">Balance</span>
                    <span className="text-[13px] font-semibold text-text1">
                      {balance !== null ? '$' + balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </span>
                  </div>
                </div>
                <div className="px-3 py-2 flex flex-col gap-1">
                  <a href="https://app.pacifica.fi" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface2 text-[12px] text-text2 transition-colors">
                    <span>↗</span> Open Pacifica
                  </a>
                  <button onClick={() => { logout(); setShowWallet(false); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-danger/5 text-[12px] text-danger transition-colors text-left">
                    <span>⏻</span> Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button onClick={login} className="bg-accent text-white text-[12px] font-semibold px-4 py-1.5 rounded-lg hover:bg-accent2 transition-colors">
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
