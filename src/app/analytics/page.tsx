'use client';
import { Analytics } from '@/components/Analytics';
import { useShell } from '@/components/AppShell';

export default function AnalyticsPage() {
  const { markets, tickers, wallet } = useShell();
  return <Analytics markets={markets} tickers={tickers} wallet={wallet} />;
}
