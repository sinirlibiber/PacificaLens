'use client';
import { usePrivy } from '@privy-io/react-auth';

export default function ConnectWalletButton() {
  const { login, ready, authenticated } = usePrivy();

  if (!ready) return null;

  if (authenticated) {
    return (
      <a
        href="/overview"
        className="px-8 py-3.5 rounded-xl font-bold text-sm text-white transition-all
                   hover:scale-[1.03] active:scale-100"
        style={{
          background: '#00b4d8',
          boxShadow : '0 0 24px rgba(0,180,216,0.4)',
        }}
      >
        Dashboard'a Gir →
      </a>
    );
  }

  return (
    <button
      onClick={login}
      className="px-8 py-3.5 rounded-xl font-bold text-sm text-white transition-all
                 hover:scale-[1.03] active:scale-100"
      style={{
        background: '#00b4d8',
        boxShadow : '0 0 24px rgba(0,180,216,0.4)',
      }}
    >
      Connect Wallet to Start
    </button>
  );
}
