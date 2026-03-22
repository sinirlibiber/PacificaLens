'use client';

import { useEffect, useState } from 'react';
import { getAccountInfo, getPositions, AccountInfo, Position } from '@/lib/pacifica';

export function useAccount(wallet: string | null) {
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet) {
      setAccountInfo(null);
      setPositions([]);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const [info, pos] = await Promise.all([
          getAccountInfo(wallet!),
          getPositions(wallet!),
        ]);
        setAccountInfo(info);
        setPositions(pos);
      } catch (e) {
        console.error('Account load error', e);
      } finally {
        setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [wallet]);

  return { accountInfo, positions, loading };
}
