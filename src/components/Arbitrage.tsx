'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Ticker, Market } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice } from '@/lib/utils';

interface ArbitrageProps {
  tickers: Record<string, Ticker>;
  markets: Market[];
}

interface ExchangeFR {
  symbol: string;
  funding: number; // per hour
  markPrice: number;
}

interface ArbOpportunity {
  symbol: string;
  pacificaFR: number;
  hlFR: number | null;
  dydxFR: number | null;
  spreadHL: number | null;
  spreadDydx: number | null;
  aprHL: number | null;
  aprDydx: number | null;
  bestApr: number;
  strategy: string;
  signal: 'STRONG' | 'GOOD' | 'LOW' | 'NONE';
  pacificaMarkPrice: number;
}

interface BotConfig {
  minApr: number;
  telegramToken: string;
  telegramChatId: string;
  discordWebhook: string;
  enabled: boolean;
  interval: number; // minutes
}

const SIGNAL_THRESHOLD = { STRONG: 15, GOOD: 8, LOW: 3 };

function normalizeSym(s: string): string {
  return s.replace(/-USD$/i, '').replace(/-PERP$/i, '').replace(/USDT$/i, '').replace(/USD$/i, '').toUpperCase().trim();
}

function SignalBadge({ signal }: { signal: ArbOpportunity['signal'] }) {
  const styles = {
    STRONG: 'bg-success/15 text-success border border-success/30',
    GOOD: 'bg-accent/15 text-accent border border-accent/30',
    LOW: 'bg-warn/15 text-warn border border-warn/30',
    NONE: 'bg-slate-100 text-text3 border border-slate-200',
  };
  return (
    <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ' + styles[signal]}>
      {signal === 'STRONG' ? '●' : signal === 'GOOD' ? '◉' : signal === 'LOW' ? '○' : '·'} {signal}
    </span>
  );
}

export function Arbitrage({ tickers, markets }: ArbitrageProps) {
  const [hlData, setHlData] = useState<Record<string, ExchangeFR>>({});
  const [dydxData, setDydxData] = useState<Record<string, ExchangeFR>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<'bestApr' | 'symbol' | 'spreadHL' | 'spreadDydx'>('bestApr');
  const [minApr, setMinApr] = useState(3);
  const [filterExchange, setFilterExchange] = useState<'all' | 'hl' | 'dydx'>('all');
  const [botConfig, setBotConfig] = useState<BotConfig>({
    minApr: 5,
    telegramToken: '',
    telegramChatId: '',
    discordWebhook: '',
    enabled: false,
    interval: 30,
  });
  const [botLog, setBotLog] = useState<string[]>([]);
  const botRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pl_bot_config');
      if (saved) setBotConfig(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('pl_bot_config', JSON.stringify(botConfig)); } catch {}
  }, [botConfig]);

  async function fetchHL() {
    try {
      const res = await fetch('/api/hyperliquid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length >= 2) {
        const universe = data[0]?.universe ?? [];
        const ctxs = data[1] ?? [];
        const map: Record<string, ExchangeFR> = {};
        universe.forEach((asset: { name: string }, i: number) => {
          const ctx = ctxs[i];
          if (ctx) {
            map[asset.name] = {
              symbol: asset.name,
              funding: Number(ctx.funding || 0),
              markPrice: Number(ctx.markPx || 0),
            };
          }
        });
        setHlData(map);
      }
    } catch (e) { console.error('HL fetch error', e); }
  }

  async function fetchDydx() {
    try {
      const res = await fetch('/api/dydx');
      const data = await res.json();
      const markets = data?.markets ?? {};
      const map: Record<string, ExchangeFR> = {};
      Object.values(markets).forEach((m: unknown) => {
        const market = m as { baseAsset: string; nextFundingRate: string; oraclePrice: string };
        const sym = market.baseAsset;
        if (sym) {
          map[sym] = {
            symbol: sym,
            funding: Number(market.nextFundingRate || 0),
            markPrice: Number(market.oraclePrice || 0),
          };
        }
      });
      setDydxData(map);
    } catch (e) { console.error('dYdX fetch error', e); }
  }

  async function fetchAll() {
    setLoading(true);
    await Promise.all([fetchHL(), fetchDydx()]);
    setLastUpdate(new Date());
    setLoading(false);
  }

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30000);
    return () => clearInterval(iv);
  }, []);

  const opportunities: ArbOpportunity[] = markets.map(m => {
    const sym = m.symbol;
    const normSym = normalizeSym(sym);
    const pacificaTk = tickers[sym];
    const pacificaFR = pacificaTk ? Number(pacificaTk.funding || 0) : 0;
    const hlEntry = hlData[normSym] ?? hlData[sym];
    const dydxEntry = dydxData[normSym] ?? dydxData[sym];
    const hlFR = hlEntry ? hlEntry.funding : null;
    const dydxFR = dydxEntry ? dydxEntry.funding : null;
    const pacificaMarkPrice = pacificaTk ? Number(pacificaTk.mark || 0) : 0;

    const spreadHL = hlFR !== null ? Math.abs(pacificaFR - hlFR) : null;
    const spreadDydx = dydxFR !== null ? Math.abs(pacificaFR - dydxFR) : null;

    const aprHL = spreadHL !== null ? spreadHL * 24 * 365 * 100 : null;
    const aprDydx = spreadDydx !== null ? spreadDydx * 24 * 365 * 100 : null;

    const bestApr = Math.max(aprHL ?? 0, aprDydx ?? 0);

    let strategy = '—';
    if (aprHL !== null && aprHL > 0 && (aprDydx === null || aprHL >= (aprDydx ?? 0))) {
      const longOn = pacificaFR > (hlFR ?? 0) ? 'HL' : 'Pacifica';
      const shortOn = longOn === 'HL' ? 'Pacifica' : 'HL';
      strategy = `Long ${longOn} / Short ${shortOn}`;
    } else if (aprDydx !== null && aprDydx > 0) {
      const longOn = pacificaFR > (dydxFR ?? 0) ? 'dYdX' : 'Pacifica';
      const shortOn = longOn === 'dYdX' ? 'Pacifica' : 'dYdX';
      strategy = `Long ${longOn} / Short ${shortOn}`;
    }

    const signal: ArbOpportunity['signal'] =
      bestApr >= SIGNAL_THRESHOLD.STRONG ? 'STRONG' :
      bestApr >= SIGNAL_THRESHOLD.GOOD ? 'GOOD' :
      bestApr >= SIGNAL_THRESHOLD.LOW ? 'LOW' : 'NONE';

    return { symbol: sym, pacificaFR, hlFR, dydxFR, spreadHL, spreadDydx, aprHL, aprDydx, bestApr, strategy, signal, pacificaMarkPrice };
  }).filter(o => {
    if (o.bestApr < minApr) return false;
    if (filterExchange === 'hl' && o.hlFR === null) return false;
    if (filterExchange === 'dydx' && o.dydxFR === null) return false;
    return true;
  }).sort((a, b) => {
    if (sortKey === 'bestApr') return b.bestApr - a.bestApr;
    if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol);
    if (sortKey === 'spreadHL') return (b.aprHL ?? 0) - (a.aprHL ?? 0);
    if (sortKey === 'spreadDydx') return (b.aprDydx ?? 0) - (a.aprDydx ?? 0);
    return 0;
  });

  const sendNotifications = useCallback(async (opps: ArbOpportunity[]) => {
    const newOpps = opps.filter(o =>
      o.signal === 'STRONG' || (o.bestApr >= botConfig.minApr)
    ).filter(o => !notifiedRef.current.has(o.symbol + '_' + Math.round(o.bestApr)));

    if (!newOpps.length) return;

    const msg = newOpps.map(o =>
      `🔥 ${o.symbol}: APR ${fmt(o.bestApr, 1)}% | ${o.strategy} | Pacifica FR: ${fmt(o.pacificaFR * 100, 4)}% | HL FR: ${o.hlFR !== null ? fmt(o.hlFR * 100, 4) + '%' : 'N/A'}`
    ).join('\n');

    const fullMsg = `🎯 PacificaLens Arbitrage Alert\n\n${msg}\n\n⏰ ${new Date().toLocaleTimeString()}`;

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('PacificaLens: ' + newOpps.length + ' Arbitrage Opportunities', { body: newOpps[0].symbol + ' APR: ' + fmt(newOpps[0].bestApr, 1) + '%' });
    }

    if (botConfig.telegramToken && botConfig.telegramChatId) {
      try {
        await fetch(`https://api.telegram.org/bot${botConfig.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: botConfig.telegramChatId, text: fullMsg }),
        });
        setBotLog(prev => [`✅ Telegram: ${newOpps.length} opps sent (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 19)]);
      } catch { setBotLog(prev => [`❌ Telegram failed (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 19)]); }
    }

    if (botConfig.discordWebhook) {
      try {
        await fetch(botConfig.discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: fullMsg }),
        });
        setBotLog(prev => [`✅ Discord: ${newOpps.length} opps sent (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 19)]);
      } catch { setBotLog(prev => [`❌ Discord failed (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 19)]); }
    }

    newOpps.forEach(o => notifiedRef.current.add(o.symbol + '_' + Math.round(o.bestApr)));
    setBotLog(prev => [`🔍 Scanned: found ${newOpps.length} new opportunities (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 19)]);
  }, [botConfig]);

  useEffect(() => {
    if (botRef.current) clearInterval(botRef.current);
    if (!botConfig.enabled) return;
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    setBotLog(prev => [`▶️ Bot started — scanning every ${botConfig.interval}min, min APR ${botConfig.minApr}%`, ...prev.slice(0, 19)]);
    botRef.current = setInterval(() => {
      sendNotifications(opportunities);
    }, botConfig.interval * 60 * 1000);
    return () => { if (botRef.current) clearInterval(botRef.current); };
  }, [botConfig.enabled, botConfig.interval, botConfig.minApr]);

  const strongCount = opportunities.filter(o => o.signal === 'STRONG').length;
  const goodCount = opportunities.filter(o => o.signal === 'GOOD').length;

  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="max-w-[1400px] mx-auto px-8 py-5 space-y-4">

        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Opportunities Found', value: String(opportunities.length), color: 'text-text1', sub: 'above min APR' },
            { label: 'Strong Signals', value: String(strongCount), color: 'text-success', sub: 'APR > ' + SIGNAL_THRESHOLD.STRONG + '%' },
            { label: 'Good Signals', value: String(goodCount), color: 'text-accent', sub: 'APR > ' + SIGNAL_THRESHOLD.GOOD + '%' },
            { label: 'Exchanges', value: '2', color: 'text-text1', sub: 'Pacifica vs HL · vs dYdX' },
            { label: 'Last Update', value: lastUpdate ? lastUpdate.toLocaleTimeString() : '—', color: 'text-text3', sub: loading ? 'Fetching...' : 'Auto 30s' },
          ].map(s => (
            <div key={s.label} className="bg-surface rounded-xl border border-border1 shadow-card p-4">
              <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
              <div className={'text-xl font-bold ' + s.color}>{s.value}</div>
              <div className="text-[10px] text-text3 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="bg-accent/5 border border-accent/20 rounded-xl p-4">
          <div className="text-[12px] font-semibold text-accent mb-1">How Cross-DEX Funding Arbitrage Works</div>
          <div className="text-[11px] text-text2 leading-relaxed">
            When Pacifica's funding rate differs significantly from Hyperliquid or dYdX, you can go <strong>long where funding is lower</strong> (receive funding) and <strong>short where funding is higher</strong> (pay less). This creates a delta-neutral position earning the spread. <strong>APR = |FR_A - FR_B| × 24h × 365</strong>. Higher APR = bigger opportunity.
          </div>
        </div>

        <div className="flex items-center gap-3 bg-surface border border-border1 rounded-xl px-4 py-3 shadow-card">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-text2">Min APR:</span>
            <input
              type="range" min="0" max="50" step="1" value={minApr}
              onChange={e => setMinApr(Number(e.target.value))}
              className="w-28"
            />
            <span className="text-[12px] font-bold text-accent w-10">{minApr}%</span>
          </div>
          <div className="w-px h-5 bg-border1" />
          <div className="flex gap-1">
            {(['all', 'hl', 'dydx'] as const).map(ex => (
              <button key={ex} onClick={() => setFilterExchange(ex)}
                className={'px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ' + (filterExchange === ex ? 'bg-accent text-white' : 'bg-surface2 border border-border1 text-text3 hover:text-text2')}>
                {ex === 'all' ? 'All' : ex === 'hl' ? 'vs Hyperliquid' : 'vs dYdX'}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={fetchAll} className="px-3 py-1 bg-surface2 border border-border1 rounded-lg text-[11px] font-semibold text-text2 hover:text-text1 transition-all">
              {loading ? '⟳ Fetching...' : '⟳ Refresh'}
            </button>
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border1 bg-surface2">
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-left">Symbol</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right">Mark Price</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right cursor-pointer hover:text-text1" onClick={() => setSortKey('symbol')}>Pacifica FR/h</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right cursor-pointer hover:text-text1" onClick={() => setSortKey('spreadHL')}>HL FR/h</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right">HL Spread APR {sortKey === 'spreadHL' ? '↓' : ''}</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right cursor-pointer hover:text-text1" onClick={() => setSortKey('spreadDydx')}>dYdX FR/h</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right">dYdX Spread APR {sortKey === 'spreadDydx' ? '↓' : ''}</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right cursor-pointer hover:text-text1 select-none" onClick={() => setSortKey('bestApr')}>Best APR {sortKey === 'bestApr' ? '↓' : ''}</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-left">Strategy</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold text-text3 uppercase text-center">Signal</th>
               </tr>
            </thead>
            <tbody>
              {opportunities.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-text3 text-sm">
                  {loading ? 'Loading exchange data...' : 'No opportunities above ' + minApr + '% APR. Lower the threshold or wait for market conditions to change.'}
                </td></tr>
              ) : opportunities.map(o => (
                <tr key={o.symbol} className={'border-b border-border1 hover:bg-slate-50/80 transition-colors ' + (o.signal === 'STRONG' ? 'bg-success/2' : '')}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <CoinLogo symbol={o.symbol} size={22} />
                      <span className="text-[12px] font-semibold text-text1">{o.symbol}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-[12px] font-mono text-text1">${fmtPrice(o.pacificaMarkPrice)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={'text-[11px] font-mono font-semibold ' + (o.pacificaFR >= 0 ? 'text-success' : 'text-danger')}>
                      {(o.pacificaFR >= 0 ? '+' : '') + fmt(o.pacificaFR * 100, 4)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {o.hlFR !== null ? (
                      <span className={'text-[11px] font-mono font-semibold ' + (o.hlFR >= 0 ? 'text-success' : 'text-danger')}>
                        {(o.hlFR >= 0 ? '+' : '') + fmt(o.hlFR * 100, 4)}%
                      </span>
                    ) : <span className="text-[10px] text-text3">N/A</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {o.aprHL !== null && o.aprHL > 0 ? (
                      <span className={'text-[12px] font-bold font-mono ' + (o.aprHL >= SIGNAL_THRESHOLD.STRONG ? 'text-success' : o.aprHL >= SIGNAL_THRESHOLD.GOOD ? 'text-accent' : 'text-warn')}>
                        {fmt(o.aprHL, 1)}%
                      </span>
                    ) : <span className="text-[10px] text-text3">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {o.dydxFR !== null ? (
                      <span className={'text-[11px] font-mono font-semibold ' + (o.dydxFR >= 0 ? 'text-success' : 'text-danger')}>
                        {(o.dydxFR >= 0 ? '+' : '') + fmt(o.dydxFR * 100, 4)}%
                      </span>
                    ) : <span className="text-[10px] text-text3">N/A</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {o.aprDydx !== null && o.aprDydx > 0 ? (
                      <span className={'text-[12px] font-bold font-mono ' + (o.aprDydx >= SIGNAL_THRESHOLD.STRONG ? 'text-success' : o.aprDydx >= SIGNAL_THRESHOLD.GOOD ? 'text-accent' : 'text-warn')}>
                        {fmt(o.aprDydx, 1)}%
                      </span>
                    ) : <span className="text-[10px] text-text3">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={'text-[13px] font-bold font-mono ' + (o.bestApr >= SIGNAL_THRESHOLD.STRONG ? 'text-success' : o.bestApr >= SIGNAL_THRESHOLD.GOOD ? 'text-accent' : 'text-warn')}>
                      {fmt(o.bestApr, 1)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-text2">{o.strategy}</td>
                  <td className="px-4 py-2.5 text-center"><SignalBadge signal={o.signal} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ArbitrageBot({ tickers, markets }: ArbitrageProps) {
  const [botConfig, setBotConfig] = useState<BotConfig>({
    minApr: 5,
    telegramToken: '',
    telegramChatId: '',
    discordWebhook: '',
    enabled: false,
    interval: 30,
  });
  const [botLog, setBotLog] = useState<string[]>([]);
  const [hlData, setHlData] = useState<Record<string, { funding: number }>>({});
  const botRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pl_bot_config');
      if (saved) setBotConfig(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('pl_bot_config', JSON.stringify(botConfig)); } catch {}
  }, [botConfig]);

  useEffect(() => {
    async function fetchHL() {
      try {
        const res = await fetch('/api/hyperliquid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        });
        const data = await res.json();
        if (Array.isArray(data) && data.length >= 2) {
          const universe = data[0]?.universe ?? [];
          const ctxs = data[1] ?? [];
          const map: Record<string, { funding: number }> = {};
          universe.forEach((asset: { name: string }, i: number) => {
            const ctx = ctxs[i];
            if (ctx) map[asset.name] = { funding: Number(ctx.funding || 0) };
          });
          setHlData(map);
        }
      } catch {}
    }
    fetchHL();
    const iv = setInterval(fetchHL, 30000);
    return () => clearInterval(iv);
  }, []);

  async function scan() {
    const opps: Array<{ symbol: string; apr: number; strategy: string }> = [];
    markets.forEach(m => {
      const pacificaFR = Number(tickers[m.symbol]?.funding || 0);
      const normSym = normalizeSym(m.symbol);
      const hlFR = (hlData[normSym] ?? hlData[m.symbol])?.funding ?? null;
      if (hlFR === null) return;
      const spread = Math.abs(pacificaFR - hlFR);
      const apr = spread * 24 * 365 * 100;
      if (apr >= botConfig.minApr) {
        const longOn = pacificaFR > hlFR ? 'HL' : 'Pacifica';
        const shortOn = longOn === 'HL' ? 'Pacifica' : 'HL';
        opps.push({ symbol: m.symbol, apr, strategy: `Long ${longOn} / Short ${shortOn}` });
      }
    });
    opps.sort((a, b) => b.apr - a.apr);

    const newOpps = opps.filter(o => !notifiedRef.current.has(o.symbol + '_' + Math.round(o.apr)));
    if (!newOpps.length) {
      setBotLog(prev => [`🔍 Scan complete — no new opps above ${botConfig.minApr}% APR (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
      return;
    }

    const msg = '🎯 PacificaLens Bot Alert\n\n' + newOpps.slice(0, 5).map(o =>
      `● ${o.symbol}: APR ${fmt(o.apr, 1)}% | ${o.strategy}`
    ).join('\n') + '\n\n⏰ ' + new Date().toLocaleTimeString();

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('PacificaLens: ' + newOpps.length + ' Arb Opportunities', {
        body: newOpps[0].symbol + ' APR: ' + fmt(newOpps[0].apr, 1) + '%',
      });
    }

    if (botConfig.telegramToken && botConfig.telegramChatId) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${botConfig.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: botConfig.telegramChatId, text: msg }),
        });
        if (r.ok) setBotLog(prev => [`✅ Telegram: sent ${newOpps.length} alerts (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
        else setBotLog(prev => [`❌ Telegram error: ${r.status} (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
      } catch (e) { setBotLog(prev => [`❌ Telegram: ${String(e)}`, ...prev.slice(0, 29)]); }
    }

    if (botConfig.discordWebhook) {
      try {
        const r = await fetch(botConfig.discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: msg }),
        });
        if (r.ok) setBotLog(prev => [`✅ Discord: sent ${newOpps.length} alerts (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
        else setBotLog(prev => [`❌ Discord error: ${r.status} (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
      } catch (e) { setBotLog(prev => [`❌ Discord: ${String(e)}`, ...prev.slice(0, 29)]); }
    }

    newOpps.forEach(o => notifiedRef.current.add(o.symbol + '_' + Math.round(o.apr)));
    setBotLog(prev => [`🔍 Found ${newOpps.length} new opportunities above ${botConfig.minApr}% APR (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
  }

  function toggleBot() {
    if (botConfig.enabled) {
      if (botRef.current) clearInterval(botRef.current);
      setBotConfig(prev => ({ ...prev, enabled: false }));
      setBotLog(prev => [`⏹ Bot stopped (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
    } else {
      if ('Notification' in window && Notification.permission !== 'granted') Notification.requestPermission();
      setBotConfig(prev => ({ ...prev, enabled: true }));
      setBotLog(prev => [`▶️ Bot started — scanning every ${botConfig.interval}min (${new Date().toLocaleTimeString()})`, ...prev.slice(0, 29)]);
      scan();
      botRef.current = setInterval(scan, botConfig.interval * 60 * 1000);
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="max-w-[900px] mx-auto px-8 py-5 space-y-4">
        <div className={'flex items-center justify-between bg-surface rounded-xl border shadow-card p-5 ' + (botConfig.enabled ? 'border-success/40' : 'border-border1')}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className={'w-2.5 h-2.5 rounded-full ' + (botConfig.enabled ? 'bg-success shadow-[0_0_8px_#10b981] animate-pulse' : 'bg-text3')} />
              <span className="text-[14px] font-bold text-text1">{botConfig.enabled ? 'Bot Running' : 'Bot Stopped'}</span>
            </div>
            <p className="text-[11px] text-text3">
              {botConfig.enabled
                ? `Scanning every ${botConfig.interval} min · Min APR ${botConfig.minApr}% · Notifications: ${(botConfig.telegramToken ? 'Telegram ' : '') + (botConfig.discordWebhook ? 'Discord ' : '') + ((!botConfig.telegramToken && !botConfig.discordWebhook) ? 'Browser only' : '')}`
                : 'Configure channels below and start the bot'}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={scan} className="px-4 py-2 bg-surface2 border border-border1 rounded-lg text-[12px] font-semibold text-text2 hover:text-text1 transition-all">
              Scan Now
            </button>
            <button onClick={toggleBot}
              className={'px-5 py-2 rounded-lg text-[12px] font-bold transition-all ' + (botConfig.enabled ? 'bg-danger text-white hover:opacity-90' : 'bg-success text-white hover:opacity-90')}>
              {botConfig.enabled ? '⏹ Stop Bot' : '▶ Start Bot'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface rounded-xl border border-border1 shadow-card p-5 space-y-4">
            <h3 className="text-[13px] font-semibold text-text1">Alert Bot Configuration</h3>
            <div className="px-3 py-2 rounded-lg bg-warn/8 border border-warn/25 text-[11px] text-warn leading-relaxed">
              <span className="font-bold">📢 Notification only.</span> Sends alerts when opportunities are found. <span className="font-semibold">Does not execute trades.</span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-[11px] font-semibold text-text2 uppercase tracking-wide">Min APR Threshold</label>
                  <span className="text-[12px] font-bold text-accent">{botConfig.minApr}%</span>
                </div>
                <input type="range" min="1" max="50" step="1" value={botConfig.minApr}
                  onChange={e => setBotConfig(p => ({ ...p, minApr: Number(e.target.value) }))} />
                <div className="flex justify-between text-[9px] text-text3 mt-0.5"><span>1%</span><span>25%</span><span>50%</span></div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-[11px] font-semibold text-text2 uppercase tracking-wide">Scan Interval</label>
                  <span className="text-[12px] font-bold text-accent">{botConfig.interval} min</span>
                </div>
                <input type="range" min="5" max="120" step="5" value={botConfig.interval}
                  onChange={e => setBotConfig(p => ({ ...p, interval: Number(e.target.value) }))} />
              </div>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border1 shadow-card p-5 space-y-3">
            <h3 className="text-[13px] font-semibold text-text1">Notification Channels</h3>
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] font-semibold text-text3 uppercase block mb-1">Telegram Bot Token</label>
                <input type="password" className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent"
                  placeholder="1234567890:AAF..." value={botConfig.telegramToken}
                  onChange={e => setBotConfig(p => ({ ...p, telegramToken: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text3 uppercase block mb-1">Telegram Chat ID</label>
                <input type="text" className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent"
                  placeholder="-1001234567890" value={botConfig.telegramChatId}
                  onChange={e => setBotConfig(p => ({ ...p, telegramChatId: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text3 uppercase block mb-1">Discord Webhook URL</label>
                <input type="password" className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-accent"
                  placeholder="https://discord.com/api/webhooks/..." value={botConfig.discordWebhook}
                  onChange={e => setBotConfig(p => ({ ...p, discordWebhook: e.target.value }))} />
              </div>
            </div>
            <div className="text-[10px] text-text3 bg-surface2 rounded-lg p-2.5 leading-relaxed">
              💡 <strong>Telegram:</strong> Create a bot via @BotFather, get token. Add bot to group, get Chat ID via @userinfobot.<br/>
              💡 <strong>Discord:</strong> Server Settings → Integrations → Webhooks → New Webhook
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border1 bg-surface2">
            <span className="text-[12px] font-semibold text-text2">Bot Activity Log</span>
            <button onClick={() => setBotLog([])} className="text-[11px] text-text3 hover:text-danger">Clear</button>
          </div>
          <div className="p-3 h-48 overflow-y-auto font-mono">
            {botLog.length === 0 ? (
              <div className="text-[11px] text-text3 p-2">No activity yet. Start the bot or click Scan Now.</div>
            ) : botLog.map((line, i) => (
              <div key={i} className={'text-[11px] py-0.5 ' + (line.startsWith('✅') ? 'text-success' : line.startsWith('❌') ? 'text-danger' : line.startsWith('▶') ? 'text-accent' : line.startsWith('⏹') ? 'text-warn' : 'text-text2')}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
