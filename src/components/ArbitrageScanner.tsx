'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useArbitrage, ArbitrageOpportunity } from '@/hooks/useArbitrage';
import { CoinLogo } from './CoinLogo';
import { fmt } from '@/lib/utils';

interface ArbitrageScannerProps {
  initialSubPage?: 'scanner' | 'bot';
  pacificaRates: Record<string, number>;
  pacificaPrices: Record<string, number>;
}

interface BotConfig {
  minAPR: number;
  telegramToken: string;
  telegramChatId: string;
  telegramActive: boolean;
  discordWebhook: string;
  discordActive: boolean;
  soundEnabled: boolean;
  browserNotif: boolean;
  exchanges: string[];
  active: boolean;
}

const DEFAULT_CONFIG: BotConfig = {
  minAPR: 20,
  telegramToken: '',
  telegramChatId: '',
  telegramActive: false,
  discordWebhook: '',
  discordActive: false,
  soundEnabled: true,
  browserNotif: true,
  exchanges: ['Pacifica', 'Hyperliquid', 'Aster', 'dYdX'],
  active: false,
};

function TierBadge({ tier }: { tier: 'high' | 'medium' | 'low' }) {
  const styles = {
    high: 'bg-success/15 text-success border border-success/30',
    medium: 'bg-warn/15 text-warn border border-warn/30',
    low: 'bg-border2/50 text-text3 border border-border2',
  };
  const labels = { high: '🔥 HIGH', medium: '⚡ MED', low: '○ LOW' };
  return <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + styles[tier]}>{labels[tier]}</span>;
}

function ExchangeBadge({ exchange, color }: { exchange: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ background: color + '18', color, borderColor: color + '40' }}>
      {exchange}
    </span>
  );
}

function SpreadBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = value >= 50 ? '#10b981' : value >= 20 ? '#f59e0b' : '#94a3b8';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + '%', background: color }} />
      </div>
      <span className="text-[11px] font-bold font-mono w-16 text-right" style={{ color }}>{fmt(value, 1)}%</span>
    </div>
  );
}

export function ArbitrageScanner({ pacificaRates, pacificaPrices, initialSubPage = "scanner" }: ArbitrageScannerProps) {
  const [subPage, setSubPage] = useState<'scanner' | 'bot'>(initialSubPage as 'scanner' | 'bot');
  const [config, setConfig] = useState<BotConfig>(() => {
    try {
      const s = localStorage.getItem('arb_bot_config');
      return s ? { ...DEFAULT_CONFIG, ...JSON.parse(s) } : DEFAULT_CONFIG;
    } catch { return DEFAULT_CONFIG; }
  });
  const [filterTier, setFilterTier] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [filterExchange, setFilterExchange] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'apr' | 'spread' | 'symbol' | 'tier'>('apr');
  const [botLog, setBotLog] = useState<{ ts: number; msg: string; type: 'info' | 'alert' | 'error' }[]>([]);
  const [sentCount, setSentCount] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevOppsRef = useRef<Set<string>>(new Set());

  const { opportunities, loading, lastUpdate, errors, refetch } = useArbitrage(pacificaRates, pacificaPrices);

  // Save config
  useEffect(() => {
    try { localStorage.setItem('arb_bot_config', JSON.stringify(config)); } catch {}
  }, [config]);

  // Play alert sound
  const playSound = useCallback(() => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }, []);

  // Send Telegram alert
  const sendTelegram = useCallback(async (msg: string, isTest = false) => {
    if (!config.telegramToken || !config.telegramChatId) return;
    if (!isTest && !config.telegramActive) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.telegramChatId, text: msg, parse_mode: 'HTML' }),
      });
      if (isTest) {
        const data = await res.json();
        if (data.ok) {
          setBotLog(prev => [{ ts: Date.now(), msg: '✓ Telegram test message sent successfully', type: 'info' as const }, ...prev]);
        } else {
          setBotLog(prev => [{ ts: Date.now(), msg: `✗ Telegram error: ${data.description || 'Check your token and chat ID'}`, type: 'error' as const }, ...prev]);
        }
      }
    } catch (e) {
      if (isTest) {
        setBotLog(prev => [{ ts: Date.now(), msg: `✗ Telegram connection failed: ${String(e)}`, type: 'error' as const }, ...prev]);
      }
    }
  }, [config.telegramToken, config.telegramChatId, config.telegramActive]);

  // Send Discord alert
  const sendDiscord = useCallback(async (msg: string, apr: number, isTest = false) => {
    if (!config.discordWebhook) return;
    if (!isTest && !config.discordActive) return;
    try {
      const res = await fetch(config.discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '\u{1F6A8} Arbitrage Opportunity Detected',
            description: msg,
            color: apr >= 50 ? 0x10b981 : 0xf59e0b,
            timestamp: new Date().toISOString(),
            footer: { text: 'PacificaLens Arb Bot' },
          }],
        }),
      });
      if (isTest) {
        if (res.ok) {
          setBotLog(prev => [{ ts: Date.now(), msg: '✓ Discord test message sent successfully', type: 'info' as const }, ...prev]);
        } else {
          setBotLog(prev => [{ ts: Date.now(), msg: `✗ Discord error: ${res.status} — Check your webhook URL`, type: 'error' as const }, ...prev]);
        }
      }
    } catch (e) {
      if (isTest) {
        setBotLog(prev => [{ ts: Date.now(), msg: `✗ Discord connection failed: ${String(e)}`, type: 'error' as const }, ...prev]);
      }
    }
  }, [config.discordWebhook, config.discordActive]);

    // Bot monitoring
  useEffect(() => {
    if (!config.active || !opportunities.length) return;

    const newOpps = opportunities.filter(o => {
      if (o.spreadAPR < config.minAPR) return false;
      if (!config.exchanges.includes(o.long.exchange) || !config.exchanges.includes(o.short.exchange)) return false;
      const key = `${o.symbol}-${o.long.exchange}-${o.short.exchange}`;
      return !prevOppsRef.current.has(key);
    });

    for (const opp of newOpps) {
      const key = `${opp.symbol}-${opp.long.exchange}-${opp.short.exchange}`;
      prevOppsRef.current.add(key);

      const msg = [
        `🚨 <b>Arbitrage Alert: ${opp.symbol}</b>`,
        `📈 LONG: ${opp.long.exchange} @ ${fmt(opp.long.fundingRate * 100, 4)}%`,
        `📉 SHORT: ${opp.short.exchange} @ ${fmt(opp.short.fundingRate * 100, 4)}%`,
        `💰 Spread APR: <b>${fmt(opp.spreadAPR, 1)}%</b>`,
        `⏱ ${new Date().toLocaleTimeString()}`,
      ].join('\n');

      const plainMsg = msg.replace(/<[^>]+>/g, '');

      if (config.soundEnabled) playSound();
      if (config.browserNotif && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('⚡ Arb Opportunity: ' + opp.symbol, {
          body: `${opp.long.exchange} vs ${opp.short.exchange} — ${fmt(opp.spreadAPR, 1)}% APR`,
        });
      }

      sendTelegram(msg);
      sendDiscord(plainMsg, opp.spreadAPR);
      setSentCount(c => c + 1);
      setBotLog(prev => [{ ts: Date.now(), msg: `NEW: ${opp.symbol} | ${opp.long.exchange}↗ vs ${opp.short.exchange}↘ | ${fmt(opp.spreadAPR, 1)}% APR (Pacifica side)`, type: 'alert' as const }, ...prev].slice(0, 50));
    }

    // Clear stale keys
    setTimeout(() => {
      for (const opp of opportunities) {
        const key = `${opp.symbol}-${opp.long.exchange}-${opp.short.exchange}`;
        if (opp.spreadAPR < config.minAPR) prevOppsRef.current.delete(key);
      }
    }, 60000);
  }, [opportunities, config, playSound, sendTelegram, sendDiscord]);

  // Request notif permission
  const requestNotifPermission = () => {
    if ('Notification' in window) Notification.requestPermission().then(p => {
      if (p === 'granted') setBotLog(prev => [{ ts: Date.now(), msg: 'Browser notifications enabled ✓', type: 'info' }, ...prev]);
    });
  };

  const [sortDir, setSortDir] = useState<Record<string, 'asc' | 'desc'>>({});

  function toggleSort(key: 'apr' | 'spread' | 'symbol' | 'tier') {
    if (sortBy === key) {
      setSortDir(prev => ({ ...prev, [key]: prev[key] === 'asc' ? 'desc' : 'asc' }));
    } else {
      setSortBy(key);
      setSortDir(prev => ({ ...prev, [key]: 'desc' }));
    }
  }

  const currentDir = sortDir[sortBy] ?? 'desc';

  const filtered = opportunities
    .filter(o => {
      // Pacifica must be on one side
      if (o.long.exchange !== 'Pacifica' && o.short.exchange !== 'Pacifica') return false;
      if (filterTier !== 'all' && o.tier !== filterTier) return false;
      if (filterExchange !== 'all' && o.long.exchange !== filterExchange && o.short.exchange !== filterExchange) return false;
      return true;
    })
    .sort((a, b) => {
      const dir = currentDir === 'desc' ? 1 : -1;
      if (sortBy === 'apr') return (b.spreadAPR - a.spreadAPR) * dir;
      if (sortBy === 'spread') return (b.spreadRate - a.spreadRate) * dir;
      if (sortBy === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      if (sortBy === 'tier') {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.tier] - order[b.tier]) * dir;
      }
      return 0;
    });

  const maxAPR = Math.max(...filtered.map(o => o.spreadAPR), 1);
  const highCount = opportunities.filter(o => o.tier === 'high').length;
  const medCount = opportunities.filter(o => o.tier === 'medium').length;

  const exchanges = ['all', 'Pacifica', 'Hyperliquid', 'Aster', 'dYdX'];

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-bg">
      {/* Sub nav */}
      <div className="flex border-b border-border1 bg-surface shrink-0 px-6 gap-6">
        {[
          { key: 'scanner', label: '📡 Arbitrage Scanner' },
          { key: 'bot', label: '🤖 Arbitrage Bot' },
        ].map(t => (
          <button key={t.key} onClick={() => setSubPage(t.key as 'scanner' | 'bot')}
            className={'py-3 text-[12px] font-semibold border-b-2 transition-all ' +
              (subPage === t.key ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 py-2">
          {lastUpdate && (
            <span className="text-[10px] text-text3">Updated {lastUpdate.toLocaleTimeString()}</span>
          )}
          <button onClick={refetch} className="px-3 py-1.5 text-[11px] bg-surface2 border border-border1 rounded-lg hover:border-accent text-text2 transition-all">
            ↻ Refresh
          </button>
          {config.active && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-success/10 border border-success/30 rounded-full">
              <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
              <span className="text-[10px] text-success font-semibold">Bot Active · {sentCount} alerts sent</span>
            </div>
          )}
        </div>
      </div>

      {subPage === 'scanner' && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-[1400px] mx-auto px-8 py-5">
            <div className="flex gap-5 items-start">
            {/* LEFT: main content */}
            <div className="flex-1 min-w-0 space-y-5">

            {/* Stats row */}
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Total Opportunities', value: String(opportunities.length), color: 'text-accent' },
                { label: '🔥 High Yield (≥50%)', value: String(highCount), color: 'text-success' },
                { label: '⚡ Medium (20-50%)', value: String(medCount), color: 'text-warn' },
                { label: 'Best APR', value: opportunities[0] ? fmt(opportunities[0].spreadAPR, 1) + '%' : '—', color: 'text-success' },
                { label: 'Perp DEX Live', value: String(4 - Object.keys(errors).length) + '/4', color: 'text-text1' },
              ].map(s => (
                <div key={s.label} className="bg-surface rounded-xl border border-border1 shadow-card p-3.5">
                  <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
                  <div className={'text-[18px] font-bold ' + s.color}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Exchange status */}
            {Object.keys(errors).length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {Object.entries(errors).map(([ex, err]) => (
                  <div key={ex} className="flex items-center gap-1.5 px-3 py-1.5 bg-danger/5 border border-danger/20 rounded-lg text-[11px] text-danger">
                    <span>⚠</span> {ex}: {err}
                  </div>
                ))}
              </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 bg-surface border border-border1 rounded-lg p-1">
                {(['all', 'high', 'medium', 'low'] as const).map(t => (
                  <button key={t} onClick={() => setFilterTier(t)}
                    className={'px-3 py-1 rounded text-[11px] font-semibold transition-all ' +
                      (filterTier === t ? 'bg-accent text-white shadow-sm' : 'text-text3 hover:text-text2')}>
                    {t === 'all' ? 'All Tiers' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 bg-surface border border-border1 rounded-lg p-1">
                {exchanges.map(ex => (
                  <button key={ex} onClick={() => setFilterExchange(ex)}
                    className={'px-2.5 py-1 rounded text-[11px] font-semibold transition-all ' +
                      (filterExchange === ex ? 'bg-accent text-white shadow-sm' : 'text-text3 hover:text-text2')}>
                    {ex === 'all' ? 'All' : ex}
                  </button>
                ))}
              </div>

            </div>

            {/* Results count */}
            <div className="text-[11px] text-text3">
              Showing <span className="font-semibold text-text1">{filtered.length}</span> opportunities across <span className="font-semibold text-text1">4</span> perps
            </div>

            {/* Table */}
            {loading ? (
              <div className="flex items-center justify-center py-20 gap-3">
                <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-text3 text-sm">Scanning exchanges...</span>
              </div>
            ) : filtered.length > 0 ? (
              <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface2 border-b border-border1">
                      {([
                        ['symbol', 'Symbol'],
                        ['tier', 'Tier'],
                        [null, 'Long Position'],
                        [null, 'Short Position'],
                        ['spread', 'Spread Rate'],
                        ['apr', 'Annualized APR'],
                        [null, 'Strategy'],
                      ] as [string | null, string][]).map(([key, label]) => (
                        <th key={label}
                          onClick={() => key && toggleSort(key as typeof sortBy)}
                          className={'px-4 py-3 text-[10px] font-semibold text-text3 uppercase tracking-wide text-left whitespace-nowrap ' + (key ? 'cursor-pointer hover:text-text1 select-none' : '')}>
                          {label}
                          {key && sortBy === key ? (currentDir === 'desc' ? ' ↓' : ' ↑') : key ? ' ↕' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((opp, i) => (
                      <tr key={i} className={'border-b border-border1 transition-colors ' + (opp.tier === 'high' ? 'hover:bg-success/3' : opp.tier === 'medium' ? 'hover:bg-warn/3' : 'hover:bg-surface2')}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <CoinLogo symbol={opp.symbol} size={26} />
                            <div>
                              <div className="text-[13px] font-bold text-text1">{opp.symbol}</div>
                              <div className="text-[10px] text-text3">Perp</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><TierBadge tier={opp.tier} /></td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <ExchangeBadge exchange={opp.long.exchange} color={opp.long.color} />
                            <div className="text-[11px] font-mono text-success">{opp.long.fundingRate >= 0 ? '+' : ''}{fmt(opp.long.fundingRate * 100, 4)}%</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <ExchangeBadge exchange={opp.short.exchange} color={opp.short.color} />
                            <div className="text-[11px] font-mono text-danger">{opp.short.fundingRate >= 0 ? '+' : ''}{fmt(opp.short.fundingRate * 100, 4)}%</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <SpreadBar value={opp.spreadAPR} max={maxAPR} />
                          <div className="text-[10px] text-text3 mt-0.5">{fmt(opp.spreadRate * 100, 4)}% per 8h</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className={'text-[18px] font-bold ' + (opp.tier === 'high' ? 'text-success' : opp.tier === 'medium' ? 'text-warn' : 'text-text2')}>
                            {fmt(opp.spreadAPR, 1)}%
                          </div>
                          <div className="text-[10px] text-text3">APR (est.)</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] px-1.5 py-0.5 bg-success/10 text-success rounded font-bold">↑ LONG</span>
                              <span className="text-[11px] text-text2">{opp.long.exchange}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] px-1.5 py-0.5 bg-danger/10 text-danger rounded font-bold">↓ SHORT</span>
                              <span className="text-[11px] text-text2">{opp.short.exchange}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-surface rounded-xl border border-border1 p-16 text-center">
                <div className="text-3xl mb-3">🔍</div>
                <div className="text-text2 font-semibold">No opportunities found</div>
                <div className="text-text3 text-sm mt-1">Try lowering the tier filter or wait for the next refresh</div>
              </div>
            )}

            </div>{/* end flex-1 */}

            {/* RIGHT: How it works card - scrollable */}
            <div className="w-64 shrink-0 overflow-y-auto" style={{ maxHeight: "calc(100vh - 120px)" }}>
              <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
                <h3 className="text-[12px] font-bold text-text1 mb-3">📖 How It Works</h3>
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold text-text1 mb-1">1. Spot the Spread</div>
                    <p className="text-text3 text-[10px] leading-relaxed">Same asset, different funding rates on two exchanges — earn the difference delta-neutral.</p>
                  </div>
                  <div className="h-px bg-border1" />
                  <div>
                    <div className="text-[11px] font-semibold text-text1 mb-1">2. Open Opposite Positions</div>
                    <p className="text-text3 text-[10px] leading-relaxed">LONG where funding is lower, SHORT where funding is higher. Price risk cancels out.</p>
                  </div>
                  <div className="h-px bg-border1" />
                  <div>
                    <div className="text-[11px] font-semibold text-text1 mb-1">3. Collect Every 8h</div>
                    <p className="text-text3 text-[10px] leading-relaxed">Earn funding spread 3× per day.<br/><span className="font-mono text-accent text-[10px]">APR = spread × 3 × 365</span></p>
                  </div>
                  <div className="h-px bg-border1" />

                </div>
              </div>
              {/* Glossary */}
              <div className="bg-surface rounded-xl border border-border1 shadow-card p-4 mt-4">
                <h3 className="text-[12px] font-bold text-text1 mb-3">📘 Glossary</h3>
                <div className="space-y-2.5">
                  {[
                    { term: 'Funding Rate', def: 'A periodic payment between longs and shorts to keep perp price close to spot. Positive = longs pay shorts. Paid every 8h.' },
                    { term: 'Spread Rate', def: 'The difference in funding rates between two exchanges for the same asset. Larger spread = more profit potential.' },
                    { term: 'APR (est.)', def: 'Annualized return estimate. Formula: Spread × 3 (payments/day) × 365 (days). Assumes rates stay constant — they will not.' },
                    { term: 'HIGH Tier', def: 'APR ≥ 50%. Strong opportunity but usually short-lived — high funding rates attract arbitrageurs and compress quickly.' },
                    { term: 'MED Tier', def: 'APR between 20–50%. More sustainable, moderate risk. Good for longer-term delta-neutral strategies.' },
                    { term: 'LOW Tier', def: 'APR below 20%. Small spread, may not cover trading fees and slippage. Monitor but proceed with caution.' },
                    { term: 'Delta-Neutral', def: 'Holding equal long + short positions so price moves do not affect PnL — only funding payments matter.' },
                    { term: 'Long Position', def: 'The exchange where you open a LONG. Usually where funding rate is lower (or negative) so you receive funding.' },
                    { term: 'Short Position', def: 'The exchange where you open a SHORT. Usually where funding rate is higher so you pay less (or also receive).' },
                  ].map(item => (
                    <div key={item.term} className="border-b border-border1 last:border-0 pb-2 last:pb-0">
                      <div className="text-[11px] font-semibold text-text1">{item.term}</div>
                      <div className="text-[10px] text-text3 leading-relaxed mt-0.5">{item.def}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            </div>{/* end flex wrapper */}
          </div>
        </div>
      )}

      {subPage === 'bot' && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-[1200px] mx-auto px-8 py-5">
            <div className="grid grid-cols-2 gap-5">

              {/* Bot Config */}
              <div className="space-y-4">
                <div className="bg-surface rounded-xl border border-border1 shadow-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[14px] font-bold text-text1">🤖 Alert Bot Configuration</h3>
                    <button
                      onClick={() => setConfig(c => ({ ...c, active: !c.active }))}
                      className={'px-4 py-2 rounded-lg text-[12px] font-bold transition-all ' +
                        (config.active ? 'bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20' : 'bg-success/10 border border-success/30 text-success hover:bg-success/20')}>
                      {config.active ? '⏹ Stop Alerts' : '▶ Start Alerts'}
                    </button>
                  </div>

                  {/* Alert-only disclaimer */}
                  <div className="mb-4 px-3 py-2.5 rounded-lg bg-warn/8 border border-warn/25 text-[11px] text-warn leading-relaxed">
                    <span className="font-bold">📢 Notification bot only.</span> This bot monitors for opportunities and sends alerts via Telegram, Discord, or browser notifications. <span className="font-semibold">It does not open or execute trades automatically.</span> You must place orders manually on the exchanges.
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1.5">Minimum APR Threshold (%)</label>
                      <div className="flex items-center gap-3">
                        <input type="range" min="5" max="200" value={config.minAPR}
                          onChange={e => setConfig(c => ({ ...c, minAPR: Number(e.target.value) }))}
                          className="flex-1 accent-accent" />
                        <span className="text-[14px] font-bold text-accent w-14 text-right">{config.minAPR}%</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1.5">Monitored Exchanges</label>
                      <div className="flex flex-wrap gap-2">
                        {['Pacifica', 'Hyperliquid', 'Aster', 'dYdX'].map(ex => (
                          <button key={ex}
                            onClick={() => setConfig(c => ({
                              ...c,
                              exchanges: c.exchanges.includes(ex) ? c.exchanges.filter(e => e !== ex) : [...c.exchanges, ex]
                            }))}
                            className={'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ' +
                              (config.exchanges.includes(ex) ? 'bg-accent/10 border-accent/30 text-accent' : 'border-border1 text-text3')}>
                            {ex}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div>
                        <div className="text-[12px] font-semibold text-text1">🔔 Sound Alerts</div>
                        <div className="text-[10px] text-text3">Beep when opportunity found</div>
                      </div>
                      <button onClick={() => setConfig(c => ({ ...c, soundEnabled: !c.soundEnabled }))}
                        className={'relative w-11 h-6 rounded-full transition-colors ' + (config.soundEnabled ? 'bg-accent' : 'bg-border2')}>
                        <div className={'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ' + (config.soundEnabled ? 'translate-x-5' : 'translate-x-0.5')} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div>
                        <div className="text-[12px] font-semibold text-text1">🖥 Browser Notifications</div>
                        <div className="text-[10px] text-text3">
                          {'Notification' in window && Notification.permission === 'granted' ? '✓ Enabled' : 'Click to enable'}
                        </div>
                      </div>
                      <button
                        onClick={() => { requestNotifPermission(); setConfig(c => ({ ...c, browserNotif: !c.browserNotif })); }}
                        className={'relative w-11 h-6 rounded-full transition-colors ' + (config.browserNotif ? 'bg-accent' : 'bg-border2')}>
                        <div className={'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ' + (config.browserNotif ? 'translate-x-5' : 'translate-x-0.5')} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Telegram */}
                <div className="bg-surface rounded-xl border border-border1 shadow-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-bold text-text1 flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.93c-.12.56-.46.7-.93.44l-2.58-1.9-1.24 1.2c-.14.14-.25.25-.52.25l.19-2.63 4.83-4.37c.21-.19-.05-.29-.32-.1L7.4 14.17l-2.53-.79c-.55-.17-.56-.55.12-.82l9.88-3.81c.46-.17.86.11.77.05z" fill="#2CA5E0"/></svg>
                      Telegram Alerts
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConfig(c => ({ ...c, telegramActive: !c.telegramActive }))}
                        className={'px-3 py-1 rounded-lg text-[11px] font-bold transition-all border ' +
                          (config.telegramActive ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success')}>
                        {config.telegramActive ? '⏹ Stop' : '▶ Start'}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Bot Token</label>
                      <input
                        type="password"
                        placeholder="123456789:ABCdef..."
                        value={config.telegramToken}
                        onChange={e => setConfig(c => ({ ...c, telegramToken: e.target.value }))}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Chat ID</label>
                      <input
                        type="text"
                        placeholder="-1001234567890"
                        value={config.telegramChatId}
                        onChange={e => setConfig(c => ({ ...c, telegramChatId: e.target.value }))}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => sendTelegram('✅ PacificaLens Arb Bot test message!\n\nConnection successful.', true)}
                        disabled={!config.telegramToken || !config.telegramChatId}
                        className="flex-1 py-2 text-[12px] font-semibold bg-blue-500/10 border border-blue-500/30 text-blue-500 rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-40">
                        Test
                      </button>
                      <button
                        onClick={() => { try { localStorage.setItem('arb_bot_config', JSON.stringify(config)); setBotLog(prev => [{ ts: Date.now(), msg: 'Telegram settings saved', type: 'info' as const }, ...prev]); } catch {} }}
                        className="px-4 py-2 text-[12px] font-semibold bg-surface2 border border-border1 rounded-lg hover:border-accent text-text2 transition-colors">
                        Save
                      </button>
                    </div>
                    <p className="text-[10px] text-text3 leading-relaxed">
                      Create a bot via @BotFather, add it to your channel/group, get the Chat ID using @userinfobot
                    </p>
                  </div>
                </div>

                {/* Discord */}
                <div className="bg-surface rounded-xl border border-border1 shadow-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-bold text-text1 flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.043.036.055a19.909 19.909 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" fill="#5865F2"/></svg>
                      Discord Alerts
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConfig(c => ({ ...c, discordActive: !c.discordActive }))}
                        className={'px-3 py-1 rounded-lg text-[11px] font-bold transition-all border ' +
                          (config.discordActive ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success')}>
                        {config.discordActive ? '⏹ Stop' : '▶ Start'}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Webhook URL</label>
                      <input
                        type="password"
                        placeholder="https://discord.com/api/webhooks/..."
                        value={config.discordWebhook}
                        onChange={e => setConfig(c => ({ ...c, discordWebhook: e.target.value }))}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => sendDiscord('✅ PacificaLens Arb Bot test message!\n\nConnection successful.', 100, true)}
                        disabled={!config.discordWebhook}
                        className="flex-1 py-2 text-[12px] font-semibold bg-indigo-500/10 border border-indigo-500/30 text-indigo-500 rounded-lg hover:bg-indigo-500/20 transition-colors disabled:opacity-40">
                        Test
                      </button>
                      <button
                        onClick={() => { try { localStorage.setItem('arb_bot_config', JSON.stringify(config)); setBotLog(prev => [{ ts: Date.now(), msg: 'Discord settings saved', type: 'info' as const }, ...prev]); } catch {} }}
                        className="px-4 py-2 text-[12px] font-semibold bg-surface2 border border-border1 rounded-lg hover:border-accent text-text2 transition-colors">
                        Save
                      </button>
                    </div>
                    <p className="text-[10px] text-text3 leading-relaxed">
                      Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL
                    </p>
                  </div>
                </div>
              </div>

              {/* Bot Activity Log */}
              <div className="space-y-4">
                <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border1 bg-surface2 flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-text1">Activity Log</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-text3">{botLog.length} events</span>
                      {botLog.length > 0 && (
                        <button onClick={() => setBotLog([])} className="text-[11px] text-text3 hover:text-danger transition-colors">Clear</button>
                      )}
                    </div>
                  </div>
                  <div className="h-64 overflow-y-auto">
                    {botLog.length > 0 ? botLog.map((log, i) => (
                      <div key={i} className={'flex items-start gap-3 px-4 py-2.5 border-b border-border1 ' + (log.type === 'alert' ? 'bg-success/3' : log.type === 'error' ? 'bg-danger/3' : '')}>
                        <span className="text-[10px] text-text3 font-mono shrink-0 mt-0.5">{new Date(log.ts).toLocaleTimeString()}</span>
                        <span className={'text-[11px] ' + (log.type === 'alert' ? 'text-success font-semibold' : log.type === 'error' ? 'text-danger' : 'text-text2')}>{log.msg}</span>
                      </div>
                    )) : (
                      <div className="flex flex-col items-center justify-center h-full text-text3 gap-2">
                        <span className="text-2xl">💤</span>
                        <p className="text-sm">Bot not started yet</p>
                        <p className="text-[11px]">Configure and press Start Bot</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live opportunities preview */}
                <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border1 bg-surface2">
                    <h3 className="text-[13px] font-bold text-text1">Top 5 Live Opportunities (Pacifica)</h3>
                  </div>
                  <div>
                    {opportunities.filter(o => o.long.exchange === 'Pacifica' || o.short.exchange === 'Pacifica').slice(0, 5).map((opp, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border1 last:border-0 hover:bg-surface2">
                        <span className="text-[11px] text-text3 font-mono w-5">{i + 1}</span>
                        <CoinLogo symbol={opp.symbol} size={22} />
                        <div className="flex-1">
                          <div className="text-[12px] font-bold text-text1">{opp.symbol}</div>
                          <div className="text-[10px] text-text3">{opp.long.exchange} ↔ {opp.short.exchange}</div>
                        </div>
                        <TierBadge tier={opp.tier} />
                        <div className={'text-[14px] font-bold ' + (opp.tier === 'high' ? 'text-success' : opp.tier === 'medium' ? 'text-warn' : 'text-text2')}>
                          {fmt(opp.spreadAPR, 1)}%
                        </div>
                      </div>
                    ))}
                    {opportunities.length === 0 && (
                      <div className="p-8 text-center text-text3 text-sm">Scanning...</div>
                    )}
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="bg-surface2 border border-border1 rounded-xl px-4 py-3 flex gap-2.5">
                  <span className="text-[16px] shrink-0">ℹ️</span>
                  <div className="text-[11px] text-text2 leading-relaxed">
                    <strong className="text-text1">Alerts only</strong> — this bot monitors funding rates and sends notifications. It does not open or close trades automatically. Use alerts to manually execute on Pacifica and the opposing exchange.
                  </div>
                </div>

                {/* Setup guide */}
                <div className="bg-accent/5 rounded-xl border border-accent/20 p-5">
                  <h3 className="text-[12px] font-bold text-accent mb-3">⚡ Quick Setup Guide</h3>
                  <ol className="space-y-2 text-[11px] text-text2">
                    <li className="flex gap-2"><span className="text-accent font-bold">1.</span> Set your minimum APR threshold (default: 20%)</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">2.</span> Select which exchanges to monitor</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">3.</span> Add Telegram token + Chat ID for mobile alerts</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">4.</span> Add Discord webhook for server alerts</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">5.</span> Enable browser notifications for desktop alerts</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">6.</span> Click <span className="text-success font-bold">Start Alerts</span> — notifications will fire when opportunities appear</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

}
