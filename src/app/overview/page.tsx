'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { Overview } from '@/components/Overview';

function OverviewPage() {
  const { markets, tickers } = useShell();
  return <div className="flex-1 overflow-hidden"><Overview markets={markets} tickers={tickers} /></div>;
}
export default function Page() {
  return <AppShell><OverviewPage /></AppShell>;
}
