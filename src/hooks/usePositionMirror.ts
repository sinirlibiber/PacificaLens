'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getPositions, Position } from '@/lib/pacifica';

export interface MirrorPosition {
  symbol: string;
  side: 'bid' | 'ask';
  traderAmount: number;
  myAmount: number;
  ratio: number;
  status: 'synced' | 'needs_open' | 'needs_close' | 'needs_resize';
}

export interface MirrorConfig {
  enabled: boolean;
  traderAccount: string;
  myAccount: string;
  ratio: number;        // 0.1 = copy 10% of trader's size
  maxPositions: number; // 0 = unlimited
}

const POLL_MS = 15_000;

export function usePositionMirror(
  myWallet: string | null,
  onAction: (action: 'open' | 'close' | 'resize', pos: MirrorPosition) => void
) {
  const [configs, setConfigs] = useState<MirrorConfig[]>([]);
  const [mirrorMap, setMirrorMap] = useState<Record<string, MirrorPosition[]>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addConfig = useCallback((cfg: Omit<MirrorConfig, 'enabled'>) => {
    setConfigs(prev => [...prev.filter(c => c.traderAccount !== cfg.traderAccount), { ...cfg, enabled: true }]);
  }, []);

  const removeConfig = useCallback((traderAccount: string) => {
    setConfigs(prev => prev.filter(c => c.traderAccount !== traderAccount));
    setMirrorMap(prev => { const n = { ...prev }; delete n[traderAccount]; return n; });
  }, []);

  const toggleConfig = useCallback((traderAccount: string) => {
    setConfigs(prev => prev.map(c => c.traderAccount === traderAccount ? { ...c, enabled: !c.enabled } : c));
  }, []);

  const checkMirror = useCallback(async () => {
    if (!myWallet) return;
    const activeConfigs = configs.filter(c => c.enabled);
    if (!activeConfigs.length) return;

    const [myPositions, ...traderPositionArrays] = await Promise.all([
      getPositions(myWallet),
      ...activeConfigs.map(c => getPositions(c.traderAccount)),
    ]);

    const myPosMap = new Map(myPositions.map(p => [p.symbol, p]));

    activeConfigs.forEach((cfg, i) => {
      const traderPositions = traderPositionArrays[i];
      const mirrors: MirrorPosition[] = [];

      // Check trader positions vs mine
      traderPositions.forEach(tp => {
        const myPos = myPosMap.get(tp.symbol);
        const traderAmt = Number(tp.amount);
        const targetAmt = traderAmt * cfg.ratio;
        const myAmt = myPos ? Number(myPos.amount) : 0;
        const sameDir = !myPos || myPos.side === tp.side;

        let status: MirrorPosition['status'] = 'synced';
        if (!myPos) status = 'needs_open';
        else if (!sameDir) status = 'needs_close';
        else if (Math.abs(myAmt - targetAmt) / targetAmt > 0.05) status = 'needs_resize';

        mirrors.push({
          symbol: tp.symbol,
          side: tp.side as 'bid' | 'ask',
          traderAmount: traderAmt,
          myAmount: myAmt,
          ratio: cfg.ratio,
          status,
        });
      });

      // Check if I have positions trader doesn't (should close)
      myPositions.forEach(mp => {
        const traderHas = traderPositions.find(tp => tp.symbol === mp.symbol);
        if (!traderHas) {
          mirrors.push({
            symbol: mp.symbol,
            side: mp.side as 'bid' | 'ask',
            traderAmount: 0,
            myAmount: Number(mp.amount),
            ratio: cfg.ratio,
            status: 'needs_close',
          });
        }
      });

      setMirrorMap(prev => ({ ...prev, [cfg.traderAccount]: mirrors }));

      // Notify about needed actions
      mirrors.forEach(m => {
        if (m.status !== 'synced') onAction(
          m.status === 'needs_open' ? 'open' : m.status === 'needs_close' ? 'close' : 'resize',
          m
        );
      });
    });
  }, [configs, myWallet, onAction]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (configs.some(c => c.enabled)) {
      checkMirror();
      intervalRef.current = setInterval(checkMirror, POLL_MS);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [configs, checkMirror]);

  return { configs, mirrorMap, addConfig, removeConfig, toggleConfig, checkMirror };
}
