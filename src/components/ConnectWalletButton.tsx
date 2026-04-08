'use client';
import { usePrivy } from '@privy-io/react-auth';

export default function ConnectWalletButton() {
  const { login, ready, authenticated } = usePrivy();
  if (!ready) return null;
  if (authenticated) {
    return (
      <a href="/overview"
        className="px-8 py-3.5 rounded-xl font-bold text-sm transition-all hover:scale-[1.03] active:scale-100"
        style={{ background: '#00b4d8', color: '#fff', boxShadow: '0 0 24px rgba(0,180,216,0.4)' }}>
        Enter Dashboard →
      </a>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <button onClick={login}
        className="px-8 py-3.5 rounded-xl font-bold text-sm transition-all hover:scale-[1.03] active:scale-100"
        style={{ background: '#00b4d8', color: '#fff', boxShadow: '0 0 24px rgba(0,180,216,0.4)' }}>
        Connect Wallet to Start
      </button>
      <a href="/overview"
        className="text-[11px] transition-colors"
        style={{ color: 'rgba(130,170,190,0.6)' }}>
        Continue as Guest →
      </a>
    </div>
  );
}
