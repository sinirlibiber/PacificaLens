'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { TradingPanel } from '@/components/TradingPanel';

function TradePage() {
  const { markets, tickers, wallet, handleExecute } = useShell();
  return <TradingPanel markets={markets} tickers={tickers} wallet={wallet} onExecute={handleExecute} />;
}
export default function Page() {
  return <AppShell><TradePage /></AppShell>;
}
