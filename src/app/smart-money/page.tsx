'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { WhaleWatcher } from '@/components/WhaleWatcher';

function SmartMoneyPage() {
  const { markets, tickers, wallet, handleExecute, accountInfo } = useShell();
  return <WhaleWatcher markets={markets} tickers={tickers} wallet={wallet} onExecute={handleExecute} accountInfo={accountInfo} />;
}
export default function Page() {
  return <AppShell><SmartMoneyPage /></AppShell>;
}
