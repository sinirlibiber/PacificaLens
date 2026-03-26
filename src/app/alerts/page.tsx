'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { PriceAlerts } from '@/components/PriceAlerts';
function AlertsPage() {
  const { markets, tickers } = useShell();
  return <div className="flex-1 overflow-hidden"><PriceAlerts markets={markets} tickers={tickers} /></div>;
}
export default function Page() {
  return <AppShell><AlertsPage /></AppShell>;
}
