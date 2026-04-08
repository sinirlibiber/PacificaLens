'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { TradingPanel } from '@/components/TradingPanel';

function GuestLock({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <span className="text-4xl">🔒</span>
      <div className="text-[16px] font-bold text-text1">{title}</div>
      <div className="text-[12px] text-text3 max-w-xs">{desc}</div>
      <a href="/" className="mt-2 px-6 py-2.5 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90"
        style={{ background: '#00b4d8', boxShadow: '0 0 20px rgba(0,180,216,0.3)' }}>
        Connect Wallet
      </a>
    </div>
  );
}

function TradePage() {
  const { markets, tickers, wallet, handleExecute, accountInfo, authenticated } = useShell();
  if (!authenticated) return (
    <GuestLock
      title="Wallet Required"
      desc="Connect your Solana wallet to place trades on Pacifica. All other features are available without a wallet."
    />
  );
  return <TradingPanel markets={markets} tickers={tickers} wallet={wallet} onExecute={handleExecute} accountInfo={accountInfo} />;
}
export default function Page() {
  return <AppShell><TradePage /></AppShell>;
}
