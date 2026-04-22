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

// ── Countdown to next funding ────────────────────────────────────────────────
function Countdown({ targetMs }: { targetMs: number }) {
  const [remaining, setRemaining] = useState(Math.max(0, targetMs - Date.now()));
  useEffect(() => {
    const iv = setInterval(() => setRemaining(Math.max(0, targetMs - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [targetMs]);
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return <span>{h > 0 ? `${h}:` : ''}{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}</span>;
}


// ── Funding frequency badge ───────────────────────────────────────────────────
function FreqBadge({ intervalHours }: { intervalHours: number }) {
  const is1h = intervalHours === 1;
  return (
    <span
      className="text-[8px] font-bold px-1.5 py-0.5 rounded"
      style={
        is1h
          ? { background: 'rgba(16,185,129,0.12)', color: '#059669', border: '0.5px solid rgba(16,185,129,0.25)' }
          : { background: 'rgba(245,158,11,0.12)', color: '#b45309', border: '0.5px solid rgba(245,158,11,0.25)' }
      }
    >
      {intervalHours}h
    </span>
  );
}

// ── Individual arbitrage card ─────────────────────────────────────────────────
function ArbCard({ opp }: { opp: ArbitrageOpportunity }) {
  const tierColor = opp.tier === 'high' ? '#10b981' : opp.tier === 'medium' ? '#f59e0b' : '#94a3b8';
  const tierLabel = opp.tier === 'high' ? 'HIGH' : opp.tier === 'medium' ? 'MED' : 'LOW';

  // Funding rate formatting
  const fmtFR = (rate: number, isLong: boolean) => {
    const youReceive = isLong ? rate <= 0 : rate >= 0;
    const color = youReceive ? '#10b981' : '#ef4444';
    const sign = youReceive ? '+' : '-';
    const pct = (Math.abs(rate) * 100).toFixed(4);
    return { youReceive, color, sign, pct };
  };

  const longFR = fmtFR(opp.long.fundingRate, true);
  const shortFR = fmtFR(opp.short.fundingRate, false);

  // BBO bar: clamp to ±1% for visual width, 50% = zero
  const bboColor = opp.bboSpread >= 0 ? '#10b981' : '#ef4444';
  const bboPct = (opp.bboSpread * 100).toFixed(3);
  const bboBarWidth = Math.min(Math.abs(opp.bboSpread) * 10000, 50); // max 50% of half-bar

  // Net hourly = sum of what you receive on both sides
  const longRecv = opp.long.fundingRate <= 0 ? Math.abs(opp.long.fundingRate) : 0;
  const shortRecv = opp.short.fundingRate >= 0 ? opp.short.fundingRate : 0;
  const netHourly = (longRecv + shortRecv) * 100;

  // Infer funding interval from exchange name (Bybit/Gate/MEXC default 4h, others 1h)
  const freqHours = (ex: string) =>
    ['Bybit', 'Gate.io', 'MEXC', 'Lighter'].includes(ex) ? 4 : 1;

  const fmtPrice = (p: number) => {
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  const nextFundingMs = Math.min(opp.long.nextFundingTime, opp.short.nextFundingTime);

  return (
    <div className="bg-surface border border-border1 rounded-xl overflow-hidden shadow-card hover:border-border2 transition-colors">

      {/* ── Header: coin + exchange pills + tier ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border1">
        <div className="flex items-center gap-2">
          <CoinLogo symbol={opp.symbol} size={20} />
          <span className="text-[13px] font-bold text-text1">{opp.symbol}/USDT</span>
          {/* Exchange pills with arrow between */}
          <div className="flex items-center gap-1">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ color: opp.long.color, background: opp.long.color + '18', border: `0.5px solid ${opp.long.color}40` }}
            >
              {opp.long.exchange.toUpperCase()}
            </span>
            <span className="text-[9px] text-text3">⟷</span>
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ color: opp.short.color, background: opp.short.color + '18', border: `0.5px solid ${opp.short.color}40` }}
            >
              {opp.short.exchange.toUpperCase()}
            </span>
          </div>
        </div>
        <span
          className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ color: tierColor, background: tierColor + '18', border: `0.5px solid ${tierColor}40` }}
        >
          {tierLabel}
        </span>
      </div>

      {/* ── 3-column body: LONG | APR center | SHORT ── */}
      <div className="grid" style={{ gridTemplateColumns: '1fr auto 1fr' }}>

        {/* LONG column */}
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-bold text-success tracking-widest">LONG</span>
            <FreqBadge intervalHours={freqHours(opp.long.exchange)} />
          </div>
          <div>
            <div className="text-[8px] text-text3 uppercase tracking-wide font-semibold">Ask </div>
            <div className="text-[15px] font-bold text-text1 font-mono leading-tight">${fmtPrice(opp.long.askPrice)}</div>
            <div className="text-[9px] text-text3 font-mono">Bid ${fmtPrice(opp.long.bidPrice)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold font-mono" style={{ color: longFR.color }}>
              {longFR.sign}{longFR.pct}% / {freqHours(opp.long.exchange)}h
            </div>
            <div className="text-[8px] text-text3 mt-0.5">
              <Countdown targetMs={opp.long.nextFundingTime} />
            </div>
          </div>
        </div>

        {/* CENTER: APR + 1h spread */}
        <div
          className="flex flex-col items-center justify-center px-3 py-3 border-x border-border1"
          style={{ minWidth: '80px' }}
        >
          <div className="text-[8px] text-text3 uppercase tracking-wide font-semibold mb-0.5">APR</div>
          <div className="text-[20px] font-bold font-mono leading-tight" style={{ color: tierColor }}>
            {fmt(opp.spreadAPR, 1)}%
          </div>
          <div className="w-full h-px bg-border1 my-2" />
          <div className="text-[8px] text-text3 uppercase tracking-wide font-semibold mb-0.5">1h spread</div>
          <div className="text-[11px] font-mono text-text2">{(opp.spreadRate * 100).toFixed(4)}%</div>
        </div>

        {/* SHORT column */}
        <div className="p-3 space-y-2 text-right">
          <div className="flex items-center justify-end gap-1.5 mb-1">
            <FreqBadge intervalHours={freqHours(opp.short.exchange)} />
            <span className="text-[10px] font-bold text-danger tracking-widest">SHORT</span>
          </div>
          <div>
            <div className="text-[8px] text-text3 uppercase tracking-wide font-semibold">Bid </div>
            <div className="text-[15px] font-bold text-text1 font-mono leading-tight">${fmtPrice(opp.short.bidPrice)}</div>
            <div className="text-[9px] text-text3 font-mono">Ask ${fmtPrice(opp.short.askPrice)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold font-mono" style={{ color: shortFR.color }}>
              {shortFR.sign}{shortFR.pct}% / {freqHours(opp.short.exchange)}h
            </div>
            <div className="text-[8px] text-text3 mt-0.5">
              <Countdown targetMs={opp.short.nextFundingTime} />
            </div>
          </div>
        </div>
      </div>

      {/* ── BBO bar row ── */}
      <div className="px-4 py-2 border-t border-border1 bg-surface2 flex items-center gap-2">
        <span className="text-[8px] text-text3 uppercase tracking-wide font-semibold shrink-0">BBO Spread</span>
        {/* Track: left = negative zone, right = positive zone */}
        <div className="flex-1 h-1 rounded-full bg-border1 relative overflow-hidden">
          {opp.bboSpread < 0 ? (
            <div
              className="absolute right-1/2 top-0 h-full rounded-l-full"
              style={{ width: `${bboBarWidth}%`, background: '#ef4444' }}
            />
          ) : (
            <div
              className="absolute left-1/2 top-0 h-full rounded-r-full"
              style={{ width: `${bboBarWidth}%`, background: '#10b981' }}
            />
          )}
          {/* Center marker */}
          <div className="absolute left-1/2 top-0 h-full w-px bg-border2 -translate-x-1/2" />
        </div>
        <span className="text-[10px] font-bold font-mono shrink-0" style={{ color: bboColor }}>
          {opp.bboSpread >= 0 ? '+' : ''}{bboPct}%
        </span>
      </div>

      {/* ── Net hourly + next funding ── */}
      <div className="px-4 py-2 border-t border-border1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[8px] text-text3 uppercase tracking-wide font-semibold">Net hourly</span>
          <span
            className="text-[11px] font-bold font-mono"
            style={{ color: netHourly > 0 ? '#10b981' : '#ef4444' }}
          >
            {netHourly > 0 ? '+' : ''}{netHourly.toFixed(4)}%
          </span>
        </div>
        <div className="flex items-center gap-1 text-[8px] text-text3">
          <span>Next funding</span>
          <span className="font-mono text-text2"><Countdown targetMs={nextFundingMs} /></span>
        </div>
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: 'high' | 'medium' | 'low' }) {
  const styles = {
    high: 'bg-success/15 text-success border border-success/30',
    medium: 'bg-warn/15 text-warn border border-warn/30',
    low: 'bg-border2/50 text-text3 border border-border2',
  };
  const labels = { high: '🔥 HIGH', medium: '⚡ MED', low: '○ LOW' };
  return <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + styles[tier]}>{labels[tier]}</span>;
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

  useEffect(() => {
    try { localStorage.setItem('arb_bot_config', JSON.stringify(config)); } catch {}
  }, [config]);

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
        if (data.ok) setBotLog(prev => [{ ts: Date.now(), msg: '✓ Telegram test message sent successfully', type: 'info' as const }, ...prev]);
        else setBotLog(prev => [{ ts: Date.now(), msg: `✗ Telegram error: ${data.description || 'Check your token and chat ID'}`, type: 'error' as const }, ...prev]);
      }
    } catch (e) {
      if (isTest) setBotLog(prev => [{ ts: Date.now(), msg: `✗ Telegram connection failed: ${String(e)}`, type: 'error' as const }, ...prev]);
    }
  }, [config.telegramToken, config.telegramChatId, config.telegramActive]);

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
        if (res.ok) setBotLog(prev => [{ ts: Date.now(), msg: '✓ Discord test message sent successfully', type: 'info' as const }, ...prev]);
        else setBotLog(prev => [{ ts: Date.now(), msg: `✗ Discord error: ${res.status} — Check your webhook URL`, type: 'error' as const }, ...prev]);
      }
    } catch (e) {
      if (isTest) setBotLog(prev => [{ ts: Date.now(), msg: `✗ Discord connection failed: ${String(e)}`, type: 'error' as const }, ...prev]);
    }
  }, [config.discordWebhook, config.discordActive]);

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
      const msg = [`🚨 <b>Arbitrage Alert: ${opp.symbol}</b>`, `📈 LONG: ${opp.long.exchange} @ ${fmt(opp.long.fundingRate * 100, 4)}%`, `📉 SHORT: ${opp.short.exchange} @ ${fmt(opp.short.fundingRate * 100, 4)}%`, `💰 Spread APR: <b>${fmt(opp.spreadAPR, 1)}%</b>`, `⏱ ${new Date().toLocaleTimeString()}`].join('\n');
      const plainMsg = msg.replace(/<[^>]+>/g, '');
      if (config.soundEnabled) playSound();
      if (config.browserNotif && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('⚡ Arb Opportunity: ' + opp.symbol, { body: `${opp.long.exchange} vs ${opp.short.exchange} — ${fmt(opp.spreadAPR, 1)}% APR` });
      }
      sendTelegram(msg);
      sendDiscord(plainMsg, opp.spreadAPR);
      setSentCount(c => c + 1);
      setBotLog(prev => [{ ts: Date.now(), msg: `NEW: ${opp.symbol} | ${opp.long.exchange}↗ vs ${opp.short.exchange}↘ | ${fmt(opp.spreadAPR, 1)}% APR`, type: 'alert' as const }, ...prev].slice(0, 50));
    }
    setTimeout(() => {
      for (const opp of opportunities) {
        const key = `${opp.symbol}-${opp.long.exchange}-${opp.short.exchange}`;
        if (opp.spreadAPR < config.minAPR) prevOppsRef.current.delete(key);
      }
    }, 60000);
  }, [opportunities, config, playSound, sendTelegram, sendDiscord]);

  const requestNotifPermission = () => {
    if ('Notification' in window) Notification.requestPermission().then(p => {
      if (p === 'granted') setBotLog(prev => [{ ts: Date.now(), msg: 'Browser notifications enabled ✓', type: 'info' }, ...prev]);
    });
  };

  const [sortDir, setSortDir] = useState<Record<string, 'asc' | 'desc'>>({});
  function toggleSort(key: 'apr' | 'spread' | 'symbol' | 'tier') {
    if (sortBy === key) setSortDir(prev => ({ ...prev, [key]: prev[key] === 'asc' ? 'desc' : 'asc' }));
    else { setSortBy(key); setSortDir(prev => ({ ...prev, [key]: 'desc' })); }
  }
  const currentDir = sortDir[sortBy] ?? 'desc';

  const exchanges = ['all', 'Hyperliquid', 'Aster', 'dYdX'];

  const filtered = opportunities
    .filter(o => {
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
      if (sortBy === 'tier') { const order = { high: 0, medium: 1, low: 2 }; return (order[a.tier] - order[b.tier]) * dir; }
      return 0;
    });

  const highCount = opportunities.filter(o => o.tier === 'high').length;
  const medCount = opportunities.filter(o => o.tier === 'medium').length;

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Sub-navigation */}
      <div className="flex items-center gap-1 px-6 pt-4 pb-0 border-b border-border1 bg-surface shrink-0">
        {([['scanner', '📡 Scanner'], ['bot', '🤖 Alert Bot']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSubPage(key)}
            className={'px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-all ' +
              (subPage === key ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}>
            {label}
            {key === 'bot' && config.active && <span className="ml-1.5 w-2 h-2 rounded-full bg-success inline-block animate-pulse" />}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 pb-2">
          {lastUpdate && <span className="text-[10px] text-text3">Updated {lastUpdate.toLocaleTimeString()}</span>}
          <button onClick={refetch} className="px-3 py-1.5 bg-surface2 border border-border1 rounded-lg text-[11px] font-semibold text-text2 hover:text-text1 transition-colors">
            {loading ? '⟳ Scanning...' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {subPage === 'scanner' && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-[1600px] mx-auto px-6 py-5">
            <div className="flex gap-5">
              {/* Main content */}
              <div className="flex-1 min-w-0 space-y-4">

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

                {/* Exchange errors */}
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
                  <div className="ml-auto flex items-center gap-2">
                    {(['apr', 'symbol'] as const).map(k => (
                      <button key={k} onClick={() => toggleSort(k)}
                        className={'px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ' +
                          (sortBy === k ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-surface border-border1 text-text3')}>
                        Sort: {k === 'apr' ? 'APR' : 'Symbol'} {sortBy === k ? (currentDir === 'desc' ? '↓' : '↑') : ''}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] text-text3">
                  Showing <span className="font-semibold text-text1">{filtered.length}</span> opportunities where Pacifica is on one side
                </div>

                {/* Cards grid */}
                {loading ? (
                  <div className="flex items-center justify-center py-20 gap-3">
                    <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                    <span className="text-text3 text-sm">Scanning exchanges for funding rate spreads...</span>
                  </div>
                ) : filtered.length > 0 ? (
                  <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
                    {filtered.map((opp, i) => (
                      <ArbCard key={i} opp={opp} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-surface rounded-xl border border-border1 p-16 text-center">
                    <div className="text-3xl mb-3">🔍</div>
                    <div className="text-text2 font-semibold">No opportunities found</div>
                    <div className="text-text3 text-sm mt-1">Try lowering the tier filter or wait for market conditions to change</div>
                  </div>
                )}

              </div>{/* end main */}

              {/* RIGHT sidebar */}
              <div className="w-60 shrink-0 overflow-y-auto space-y-4" style={{ maxHeight: 'calc(100vh - 120px)' }}>
                <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
                  <h3 className="text-[12px] font-bold text-text1 mb-3">📖 How It Works</h3>
                  <div className="space-y-3">
                    {[
                      { title: '1. Spot the Spread', body: 'Same asset, different funding rates — earn the difference delta-neutral.' },
                      { title: '2. Open Opposite Positions', body: 'LONG where funding is lower (receive), SHORT where higher (pay more).' },
                      { title: '3. Collect Every 1h / 4h', body: 'APR = |spread| × 24 × 365. Frequency badge shows each exchange\'s interval.' },
                      { title: '4. BBO Spread Bar', body: 'Red bar = entry costs you. Green bar = entry earns you. Factor into net P&L.' },
                      { title: '5. Net Hourly', body: 'Combined receive rate from both sides. Your actual hourly yield before fees.' },
                    ].map(s => (
                      <div key={s.title}>
                        <div className="text-[11px] font-semibold text-text1 mb-0.5">{s.title}</div>
                        <p className="text-text3 text-[10px] leading-relaxed">{s.body}</p>
                        <div className="h-px bg-border1 mt-2" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
                  <h3 className="text-[12px] font-bold text-text1 mb-3">📘 Legend</h3>
                  <div className="space-y-2">
                    {[
                      { label: '+rate%', color: 'text-success', def: 'You receive this funding rate' },
                      { label: '−rate%', color: 'text-danger', def: 'You pay this funding rate' },
                      { label: 'Ask (Entry)', color: 'text-text2', def: 'Long position fills at ask price' },
                      { label: 'Bid (Entry)', color: 'text-text2', def: 'Short position fills at bid price' },
                      { label: 'BBO Spread bar', color: 'text-text2', def: 'Red = entry costs · Green = entry earns' },
                      { label: 'Net hourly', color: 'text-success', def: 'Combined receive rate from both sides' },
                      { label: '1h / 4h badge', color: 'text-warn', def: 'Funding interval for that exchange' },
                    ].map(item => (
                      <div key={item.label} className="border-b border-border1 last:border-0 pb-1.5 last:pb-0">
                        <div className={'text-[11px] font-semibold ' + item.color}>{item.label}</div>
                        <div className="text-[10px] text-text3">{item.def}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
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
                  <div className="mb-4 px-3 py-2.5 rounded-lg bg-warn/8 border border-warn/25 text-[11px] text-warn leading-relaxed">
                    <span className="font-bold">📢 Notification bot only.</span> Monitors for opportunities and sends alerts. Does not execute trades automatically.
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
                            onClick={() => setConfig(c => ({ ...c, exchanges: c.exchanges.includes(ex) ? c.exchanges.filter(e => e !== ex) : [...c.exchanges, ex] }))}
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
                        <div className="text-[10px] text-text3">{'Notification' in window && Notification.permission === 'granted' ? '✓ Enabled' : 'Click to enable'}</div>
                      </div>
                      <button onClick={() => { requestNotifPermission(); setConfig(c => ({ ...c, browserNotif: !c.browserNotif })); }}
                        className={'relative w-11 h-6 rounded-full transition-colors ' + (config.browserNotif ? 'bg-accent' : 'bg-border2')}>
                        <div className={'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ' + (config.browserNotif ? 'translate-x-5' : 'translate-x-0.5')} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Telegram */}
                <div className="bg-surface rounded-xl border border-border1 shadow-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-bold text-text1">📱 Telegram Alerts</h3>
                    <button onClick={() => setConfig(c => ({ ...c, telegramActive: !c.telegramActive }))}
                      className={'px-3 py-1 rounded-lg text-[11px] font-bold transition-all border ' +
                        (config.telegramActive ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success')}>
                      {config.telegramActive ? '⏹ Stop' : '▶ Start'}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Bot Token</label>
                      <input type="password" placeholder="123456789:ABCdef..." value={config.telegramToken}
                        onChange={e => setConfig(c => ({ ...c, telegramToken: e.target.value }))}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent font-mono" />
                    </div>
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Chat ID</label>
                      <input type="text" placeholder="-1001234567890" value={config.telegramChatId}
                        onChange={e => setConfig(c => ({ ...c, telegramChatId: e.target.value }))}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent font-mono" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => sendTelegram('✅ PacificaLens Arb Bot test message!\n\nConnection successful.', true)}
                        disabled={!config.telegramToken || !config.telegramChatId}
                        className="flex-1 py-2 text-[12px] font-semibold bg-blue-500/10 border border-blue-500/30 text-blue-500 rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-40">
                        Test
                      </button>
                      <button onClick={() => { try { localStorage.setItem('arb_bot_config', JSON.stringify(config)); setBotLog(prev => [{ ts: Date.now(), msg: 'Telegram settings saved', type: 'info' as const }, ...prev]); } catch {} }}
                        className="px-4 py-2 text-[12px] font-semibold bg-surface2 border border-border1 rounded-lg hover:border-accent text-text2 transition-colors">
                        Save
                      </button>
                    </div>
                    <p className="text-[10px] text-text3 leading-relaxed">Create a bot via @BotFather, add it to your channel/group, get Chat ID via @userinfobot</p>
                  </div>
                </div>

                {/* Discord */}
                <div className="bg-surface rounded-xl border border-border1 shadow-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-bold text-text1">💬 Discord Alerts</h3>
                    <button onClick={() => setConfig(c => ({ ...c, discordActive: !c.discordActive }))}
                      className={'px-3 py-1 rounded-lg text-[11px] font-bold transition-all border ' +
                        (config.discordActive ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success')}>
                      {config.discordActive ? '⏹ Stop' : '▶ Start'}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Webhook URL</label>
                      <input type="password" placeholder="https://discord.com/api/webhooks/..." value={config.discordWebhook}
                        onChange={e => setConfig(c => ({ ...c, discordWebhook: e.target.value }))}
                        className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent font-mono" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => sendDiscord('✅ PacificaLens Arb Bot test!\n\nConnection successful.', 100, true)}
                        disabled={!config.discordWebhook}
                        className="flex-1 py-2 text-[12px] font-semibold bg-indigo-500/10 border border-indigo-500/30 text-indigo-500 rounded-lg hover:bg-indigo-500/20 transition-colors disabled:opacity-40">
                        Test
                      </button>
                      <button onClick={() => { try { localStorage.setItem('arb_bot_config', JSON.stringify(config)); setBotLog(prev => [{ ts: Date.now(), msg: 'Discord settings saved', type: 'info' as const }, ...prev]); } catch {} }}
                        className="px-4 py-2 text-[12px] font-semibold bg-surface2 border border-border1 rounded-lg hover:border-accent text-text2 transition-colors">
                        Save
                      </button>
                    </div>
                    <p className="text-[10px] text-text3 leading-relaxed">Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL</p>
                  </div>
                </div>
              </div>

              {/* Activity Log */}
              <div className="space-y-4">
                <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border1 bg-surface2 flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-text1">Activity Log</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-text3">{botLog.length} events · {sentCount} sent</span>
                      {botLog.length > 0 && <button onClick={() => setBotLog([])} className="text-[11px] text-text3 hover:text-danger transition-colors">Clear</button>}
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
                      </div>
                    )}
                  </div>
                </div>

                {/* Live preview */}
                <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border1 bg-surface2">
                    <h3 className="text-[13px] font-bold text-text1">Top 5 Live (Pacifica side)</h3>
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
                    {opportunities.length === 0 && <div className="p-8 text-center text-text3 text-sm">Scanning...</div>}
                  </div>
                </div>

                <div className="bg-accent/5 rounded-xl border border-accent/20 p-5">
                  <h3 className="text-[12px] font-bold text-accent mb-3">⚡ Quick Setup</h3>
                  <ol className="space-y-2 text-[11px] text-text2">
                    <li className="flex gap-2"><span className="text-accent font-bold">1.</span> Set minimum APR threshold</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">2.</span> Select exchanges to monitor</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">3.</span> Add Telegram token + Chat ID</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">4.</span> Add Discord webhook</li>
                    <li className="flex gap-2"><span className="text-accent font-bold">5.</span> Click <span className="text-success font-bold">Start Alerts</span></li>
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
