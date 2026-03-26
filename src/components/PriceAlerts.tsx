'use client';
import { useState } from 'react';
import { usePriceAlerts, AlertCondition } from '@/hooks/usePriceAlerts';
import { Market, Ticker } from '@/lib/pacifica';
import { fmtPrice } from '@/lib/utils';

interface PriceAlertsProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  embedded?: boolean;
}

export function PriceAlerts({ markets, tickers, embedded }: PriceAlertsProps) {
  const { alerts, notifEnabled, toggleNotifications, addAlert, removeAlert, toggleAlert } = usePriceAlerts(tickers);
  const [symbol, setSymbol] = useState('BTC');
  const [condition, setCondition] = useState<AlertCondition>('above');
  const [price, setPrice] = useState('');

  const markPrice = tickers[symbol] ? Number(tickers[symbol].mark || tickers[symbol].mid || 0) : 0;

  function handleAdd() {
    const p = Number(price);
    if (!p || !symbol) return;
    addAlert(symbol, condition, p);
    setPrice('');
  }

  const active = alerts.filter(a => !a.triggered && a.enabled);
  const triggered = alerts.filter(a => a.triggered);

  return (
    <div className={embedded ? "" : "flex flex-col h-full overflow-hidden bg-bg"}>
      <div className={embedded ? "" : "flex-1 overflow-y-auto"}>
        <div className={embedded ? "px-4 py-4" : "max-w-[900px] mx-auto px-6 py-6"}>

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-[20px] font-bold text-text1">Price Alerts</h1>
              <p className="text-[11px] text-text3 mt-0.5">Get notified when prices hit your targets</p>
            </div>
            {/* Notification toggle */}
            <button onClick={toggleNotifications}
              className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border transition-all ${
                notifEnabled
                  ? 'bg-success/8 border-success/30 text-success'
                  : 'bg-surface border-border1 text-text3 hover:border-accent/40 hover:text-accent'
              }`}>
              <span className="text-[14px]">{notifEnabled ? '🔔' : '🔕'}</span>
              <div className="text-left">
                <div className="text-[11px] font-semibold">{notifEnabled ? 'Notifications On' : 'Notifications Off'}</div>
                <div className="text-[9px] opacity-70">{notifEnabled ? 'Click to disable' : 'Click to enable'}</div>
              </div>
              <div className={`relative w-9 h-5 rounded-full transition-all ml-1 ${notifEnabled ? 'bg-success' : 'bg-border2'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifEnabled ? 'translate-x-4' : ''}`} />
              </div>
            </button>
          </div>

          {/* Add alert form */}
          <div className="bg-surface border border-border1 rounded-2xl p-5 mb-6">
            <div className="text-[12px] font-semibold text-text1 mb-4">New Alert</div>
            <div className="grid grid-cols-4 gap-3 items-end">
              {/* Symbol */}
              <div>
                <label className="text-[10px] text-text3 uppercase font-semibold block mb-1.5">Symbol</label>
                <select value={symbol} onChange={e => setSymbol(e.target.value)}
                  className="w-full bg-surface2 border border-border1 rounded-xl px-3 py-2 text-[12px] text-text1 outline-none focus:border-accent transition-colors">
                  {markets.map(m => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                </select>
              </div>
              {/* Condition */}
              <div>
                <label className="text-[10px] text-text3 uppercase font-semibold block mb-1.5">Condition</label>
                <div className="grid grid-cols-2 gap-1">
                  {(['above', 'below'] as const).map(c => (
                    <button key={c} onClick={() => setCondition(c)}
                      className={`py-2 text-[11px] font-semibold rounded-xl border transition-all ${
                        condition === c
                          ? c === 'above' ? 'bg-success/10 border-success/40 text-success' : 'bg-danger/10 border-danger/40 text-danger'
                          : 'bg-surface2 border-border1 text-text3 hover:border-border2'
                      }`}>
                      {c === 'above' ? '↑ Above' : '↓ Below'}
                    </button>
                  ))}
                </div>
              </div>
              {/* Price */}
              <div>
                <label className="text-[10px] text-text3 uppercase font-semibold block mb-1.5">
                  Target Price
                  {markPrice > 0 && <span className="ml-1 text-text3 normal-case">· now ${fmtPrice(markPrice)}</span>}
                </label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                  placeholder={markPrice > 0 ? fmtPrice(markPrice) : '0'}
                  className="w-full bg-surface2 border border-border1 rounded-xl px-3 py-2 text-[12px] font-mono text-text1 outline-none focus:border-accent transition-colors"
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              {/* Add button */}
              <button onClick={handleAdd} disabled={!price || Number(price) <= 0}
                className="py-2 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent/90 transition-colors disabled:opacity-40">
                + Add Alert
              </button>
            </div>
          </div>

          {/* Active alerts */}
          {active.length > 0 && (
            <div className="mb-6">
              <div className="text-[11px] text-text3 uppercase font-semibold tracking-wide mb-3">
                Active ({active.length})
              </div>
              <div className="space-y-2">
                {active.map(alert => {
                  const current = tickers[alert.symbol] ? Number(tickers[alert.symbol].mark || 0) : 0;
                  const dist = current > 0 ? Math.abs(((alert.price - current) / current) * 100) : null;
                  return (
                    <div key={alert.id} className="bg-surface border border-border1 rounded-xl px-4 py-3 flex items-center gap-4">
                      <div className="flex-1 grid grid-cols-4 gap-4 items-center">
                        <div className="font-bold text-[13px] text-text1">{alert.symbol}</div>
                        <div className={`text-[12px] font-semibold ${alert.condition === 'above' ? 'text-success' : 'text-danger'}`}>
                          {alert.condition === 'above' ? '↑ Above' : '↓ Below'} ${alert.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[11px] text-text3">
                          {current > 0 && `Now $${fmtPrice(current)}`}
                          {dist !== null && <span className="ml-2 font-mono">{dist.toFixed(1)}% away</span>}
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => toggleAlert(alert.id)}
                            className={`relative w-8 h-4 rounded-full transition-all ${alert.enabled ? 'bg-accent' : 'bg-border2'}`}>
                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${alert.enabled ? 'translate-x-4' : ''}`} />
                          </button>
                          <button onClick={() => removeAlert(alert.id)}
                            className="w-6 h-6 flex items-center justify-center text-text3 hover:text-danger transition-colors text-[14px]">×</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Triggered alerts */}
          {triggered.length > 0 && (
            <div>
              <div className="text-[11px] text-text3 uppercase font-semibold tracking-wide mb-3">
                Triggered ({triggered.length})
              </div>
              <div className="space-y-2">
                {triggered.map(alert => (
                  <div key={alert.id} className="bg-surface border border-border1 rounded-xl px-4 py-3 flex items-center gap-4 opacity-60">
                    <div className="flex-1 grid grid-cols-4 gap-4 items-center">
                      <div className="font-bold text-[13px] text-text1">{alert.symbol}</div>
                      <div className="text-[12px] text-text3">
                        {alert.condition === 'above' ? '↑ Above' : '↓ Below'} ${alert.price.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-success font-semibold">✓ Triggered</div>
                      <div className="flex justify-end">
                        <button onClick={() => removeAlert(alert.id)}
                          className="text-[10px] text-text3 hover:text-danger border border-border1 hover:border-danger/30 px-2 py-1 rounded-lg transition-all">
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {alerts.length === 0 && (
            <div className="text-center py-20">
              <div className="text-[32px] mb-3">🔔</div>
              <div className="text-[13px] text-text3">No alerts yet</div>
              <div className="text-[11px] text-text3 mt-1">Add a price alert above to get started</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
