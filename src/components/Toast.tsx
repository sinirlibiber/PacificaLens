'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info' | 'loading';
  duration?: number;
  action?: { label: string; href: string };
  onClose: () => void;
}

export function Toast({ message, type = 'info', duration, action, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  const autoClose = duration !== undefined ? duration : type === 'loading' ? 0 : 4500;

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 10);
    const hide = autoClose > 0
      ? setTimeout(() => { setVisible(false); setTimeout(onClose, 300); }, autoClose)
      : null;
    return () => { clearTimeout(show); if (hide) clearTimeout(hide); };
  }, [autoClose, onClose]);

  const close = () => { setVisible(false); setTimeout(onClose, 300); };

  const cfg = {
    success: { border: 'border-success/40', bg: 'bg-success/8',  icon: '✓', iconBg: 'bg-success/15 text-success' },
    error:   { border: 'border-danger/40',  bg: 'bg-danger/8',   icon: '✕', iconBg: 'bg-danger/15 text-danger' },
    info:    { border: 'border-accent/30',  bg: 'bg-accent/5',   icon: 'ℹ', iconBg: 'bg-accent/15 text-accent' },
    loading: { border: 'border-border2',    bg: 'bg-surface',    icon: '',  iconBg: '' },
  }[type];

  return (
    <div className={`transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      <div className={`flex items-start gap-3 border rounded-2xl px-4 py-3.5 shadow-card-md min-w-[280px] max-w-xs ${cfg.border} ${cfg.bg}`}>
        {/* Icon / Spinner */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${type !== 'loading' ? cfg.iconBg : ''}`}>
          {type === 'loading'
            ? <div className="w-4 h-4 border-2 border-border2 border-t-accent rounded-full animate-spin" />
            : <span className="text-[11px] font-bold">{cfg.icon}</span>
          }
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-text1 leading-relaxed font-medium">{message}</p>
          {action && (
            <button
              onClick={() => { router.push(action.href); close(); }}
              className="mt-1.5 text-[11px] font-semibold text-accent hover:underline flex items-center gap-1">
              {action.label}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          )}
        </div>
        {/* Close */}
        {type !== 'loading' && (
          <button onClick={close} className="text-text3 hover:text-text1 transition-colors text-[14px] leading-none mt-0.5 shrink-0">✕</button>
        )}
      </div>
    </div>
  );
}
