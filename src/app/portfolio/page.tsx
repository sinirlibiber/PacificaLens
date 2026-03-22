'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { Portfolio } from '@/components/Portfolio';

function PortfolioPage() {
  const { wallet, tickers, markets } = useShell();
  return <div className="flex-1 overflow-hidden"><Portfolio wallet={wallet} tickers={tickers} markets={markets} /></div>;
}

export default function Page() {
  return <AppShell><PortfolioPage /></AppShell>;
}
