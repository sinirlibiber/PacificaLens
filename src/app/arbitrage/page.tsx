'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { ArbitrageScanner } from '@/components/ArbitrageScanner';
import { getMarkPrice } from '@/lib/utils';

function ArbPage() {
  const { markets, tickers } = useShell();
  const pacificaRates: Record<string, number> = {};
  const pacificaPrices: Record<string, number> = {};
  for (const m of markets) {
    const tk = tickers[m.symbol];
    if (tk) { pacificaRates[m.symbol] = Number(tk.funding || 0); pacificaPrices[m.symbol] = getMarkPrice(tk); }
  }
  return <ArbitrageScanner pacificaRates={pacificaRates} pacificaPrices={pacificaPrices} initialSubPage="scanner" />;
}
export default function Page() {
  return <AppShell><ArbPage /></AppShell>;
}
