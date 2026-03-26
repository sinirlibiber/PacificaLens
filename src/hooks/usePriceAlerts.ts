'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Ticker } from '@/lib/pacifica';

export type AlertCondition = 'above' | 'below';
export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  enabled: boolean;
  triggered: boolean;
  createdAt: number;
  triggeredAt?: number;
}

const LS_KEY = 'pacificalens_price_alerts_v1';

export function usePriceAlerts(tickers: Record<string, Ticker>) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const notifPermRef = useRef<NotificationPermission>('default');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setAlerts(JSON.parse(raw));
      const pref = localStorage.getItem('pacificalens_notif_enabled');
      setNotifEnabled(pref === '1');
    } catch {}
    if (typeof Notification !== 'undefined') {
      notifPermRef.current = Notification.permission;
    }
  }, []);

  const save = (list: PriceAlert[]) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch {}
  };

  const toggleNotifications = useCallback(async () => {
    if (notifEnabled) {
      setNotifEnabled(false);
      localStorage.setItem('pacificalens_notif_enabled', '0');
      return;
    }
    if (typeof Notification === 'undefined') return;
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    notifPermRef.current = perm;
    if (perm === 'granted') {
      setNotifEnabled(true);
      localStorage.setItem('pacificalens_notif_enabled', '1');
      new Notification('PacificaLens', { body: 'Price alerts enabled!', icon: '/pacificalens.ico' });
    }
  }, [notifEnabled]);

  const addAlert = useCallback((symbol: string, condition: AlertCondition, price: number) => {
    const alert: PriceAlert = {
      id: crypto.randomUUID(), symbol, condition, price,
      enabled: true, triggered: false, createdAt: Date.now(),
    };
    setAlerts(prev => { const next = [alert, ...prev]; save(next); return next; });
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts(prev => { const next = prev.filter(a => a.id !== id); save(next); return next; });
  }, []);

  const toggleAlert = useCallback((id: string) => {
    setAlerts(prev => {
      const next = prev.map(a => a.id === id ? { ...a, enabled: !a.enabled, triggered: false } : a);
      save(next); return next;
    });
  }, []);

  // Check alerts against live prices
  useEffect(() => {
    if (!Object.keys(tickers).length) return;
    setAlerts(prev => {
      let changed = false;
      const next = prev.map(alert => {
        if (!alert.enabled || alert.triggered) return alert;
        const tk = tickers[alert.symbol];
        if (!tk) return alert;
        const price = Number(tk.mark || tk.mid || 0);
        if (!price) return alert;
        const hit = alert.condition === 'above' ? price >= alert.price : price <= alert.price;
        if (!hit) return alert;
        changed = true;
        if (notifEnabled && notifPermRef.current === 'granted') {
          new Notification(`PacificaLens — ${alert.symbol} Alert`, {
            body: `${alert.symbol} is ${alert.condition} $${alert.price.toLocaleString()} (now $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })})`,
            icon: '/pacificalens.ico',
          });
        }
        return { ...alert, triggered: true, triggeredAt: Date.now() };
      });
      if (changed) save(next);
      return changed ? next : prev;
    });
  }, [tickers, notifEnabled]);

  return { alerts, notifEnabled, toggleNotifications, addAlert, removeAlert, toggleAlert };
}
