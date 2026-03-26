'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { RiskManager } from '@/components/RiskManager';

function RiskPage() {
  const { markets, tickers, fundingRates, positions, accountInfo, accountSize, setAccountSize, wallet, error, handleExecute } = useShell();
  return (
    <RiskManager
      markets={markets} tickers={tickers} fundingRates={fundingRates}
      positions={positions} accountInfo={accountInfo}
      accountSize={accountSize} onAccountSizeChange={setAccountSize}
      wallet={wallet} error={error} onExecute={handleExecute}
    />
  );
}

export default function Page() {
  return <AppShell><RiskPage /></AppShell>;
}