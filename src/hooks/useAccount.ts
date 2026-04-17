'use client';

import { useEffect, useState, useRef } from 'react';
import { getAccountInfo, getPositions, AccountInfo, Position } from '@/lib/pacifica';

export function useAccount(wallet: string | null) {
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  // Keep wallet in a ref so interval callback always reads current value
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  useEffect(() => {
    if (!wallet) {
      setAccountInfo(null);
      setPositions([]);
      return;
    }

    let cancelled = false;

    async function load() {
      const currentWallet = walletRef.current;
      if (!currentWallet) return;
      setLoading(true);
      try {
        const [info, pos] = await Promise.all([
          getAccountInfo(currentWallet),
          getPositions(currentWallet),
        ]);
        // Discard if wallet changed while request was in flight
        if (cancelled || walletRef.current !== currentWallet) return;
        setAccountInfo(info);
        setPositions(pos);
      } catch (e) {
        console.error('Account load error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [wallet]);

  return { accountInfo, positions, loading };
}