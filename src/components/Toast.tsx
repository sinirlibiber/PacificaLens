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
    success: { borderColor: 'var(--success)', bg: 'var(--success-bg)', iconColor: 'var(--success)', icon: '✓' },
    error:   { borderColor: 'var(--danger)',  bg: 'var(--danger-bg)',  iconColor: 'var(--danger)',  icon: '✕' },
    info:    { borderColor: 'var(--accent)',  bg: 'var(--accent-glow)',iconColor: 'var(--accent)',  icon: 'ℹ' },
    loading: { borderColor: 'var(--border2)', bg: 'var(--surface)',    iconColor: 'var(--accent)',  icon: '' },
  }[type];

  return (
    <div className={`transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5 min-w-[280px] max-w-xs"
        style={{ background: cfg.bg, border: `1px solid ${cfg.borderColor}`, boxShadow: 'var(--shadow-md)' }}>
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: type !== 'loading' ? cfg.bg : 'transparent', color: cfg.iconColor }}>
          {type === 'loading'
            ? <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border2)', borderTopColor: 'var(--accent)' }} />
            : <span className="text-[11px] font-bold">{cfg.icon}</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] leading-relaxed font-medium" style={{ color: 'var(--text1)' }}>{message}</p>
          {action && (
            <button onClick={() => { router.push(action.href); close(); }}
              className="mt-1.5 text-[11px] font-semibold flex items-center gap-1 hover:underline"
              style={{ color: 'var(--accent)' }}>
              {action.label}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          )}
        </div>
        {type !== 'loading' && (
          <button onClick={close} className="transition-colors text-[14px] leading-none mt-0.5 shrink-0"
            style={{ color: 'var(--text3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}>✕</button>
        )}
      </div>
    </div>
  );
}
