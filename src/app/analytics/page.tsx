'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { Analytics } from '@/components/Analytics';

function AnalyticsInner() {
  const { markets, tickers, wallet } = useShell();
  return (
    <div className="flex-1 overflow-hidden">
      <Analytics markets={markets} tickers={tickers} wallet={wallet} />
    </div>
  );
}

export default function Page() {
  return <AppShell><AnalyticsInner /></AppShell>;
}
