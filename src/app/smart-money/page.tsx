'use client';
import { AppShell, useShell } from '@/components/AppShell';
import { CopyTrading } from '@/components/CopyTrading';
import { useState } from 'react';

interface ToastState { message: string; type: 'success' | 'error' | 'info'; }

function CopyTradingPage() {
  const { markets, tickers, wallet, accountInfo, ensureBuilderApproved } = useShell();
  const [toast, setToast] = useState<ToastState | null>(null);

  function handleToast(message: string, type: 'success' | 'error' | 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <>
      <CopyTrading
        markets={markets}
        tickers={tickers}
        wallet={wallet}
        accountInfo={accountInfo}
        onToast={handleToast}
        ensureBuilderApproved={ensureBuilderApproved}
      />
      {toast && (
        <div className={`fixed bottom-4 right-4 z-[100] px-4 py-3 rounded-xl shadow-card-md text-[12px] font-semibold border max-w-sm ${
          toast.type === 'success' ? 'bg-success/10 text-success border-success/30' :
          toast.type === 'error'   ? 'bg-danger/10 text-danger border-danger/30' :
          'bg-accent/10 text-accent border-accent/30'
        }`}>
          {toast.message}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <AppShell><CopyTradingPage /></AppShell>;
}
