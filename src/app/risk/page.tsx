'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { RiskManager } from '@/components/RiskManager';

function RiskPage() {
  const { markets, tickers, fundingRates, positions, accountInfo, accountSize, setAccountSize, wallet, error, handleExecute, authenticated } = useShell();
  
  // Guest: position-based features kilitli ama calculator açık
  return (
    <div className="relative flex-1 h-full flex flex-col">
      <RiskManager
        markets={markets} tickers={tickers} fundingRates={fundingRates}
        positions={positions} accountInfo={accountInfo}
        accountSize={accountSize} onAccountSizeChange={setAccountSize}
        wallet={wallet} error={error} onExecute={handleExecute}
      />
      {!authenticated && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Sadece üst kısmı (kişisel hesap verileri) maskele, calculator serbest */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-center gap-3 px-4 py-2 text-[11px]"
            style={{ background: 'rgba(0,180,216,0.08)', borderBottom: '1px solid rgba(0,180,216,0.15)', pointerEvents: 'auto' }}>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: 'rgba(0,180,216,0.15)', color: '#00b4d8' }}>GUEST</span>
            <span style={{ color: 'rgba(160,200,220,0.8)' }}>
              Position data requires wallet · Calculator available
            </span>
            <a href="/" className="ml-auto text-[10px] font-semibold"
              style={{ color: '#00b4d8' }}>Connect →</a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return <AppShell><RiskPage /></AppShell>;
}
