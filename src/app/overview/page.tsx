'use client';
import dynamic from 'next/dynamic';
import { AppShell, useShell } from '@/components/AppShell';
import { Overview } from '@/components/Overview';

const OnboardingModal = dynamic(() => import('@/components/OnboardingModal'), { ssr: false });

function OverviewPage() {
  const { markets, tickers } = useShell();
  return (
    <div className="flex-1 overflow-hidden">
      <OnboardingModal />
      <Overview markets={markets} tickers={tickers} />
    </div>
  );
}
export default function Page() {
  return <AppShell><OverviewPage /></AppShell>;
}
