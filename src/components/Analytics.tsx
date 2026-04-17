'use client';

import { useState, useEffect } from 'react';
import { Market, Ticker } from '@/lib/pacifica';
import { fmt } from '@/lib/utils';
import { CoinLogo } from './CoinLogo';
import AiAssistant from './AiAssistant';
import { useWhaleWatcher } from '@/hooks/useWhaleWatcher';
import HeatmapView from './HeatmapView';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';

interface AnalyticsProps {
  markets?: Market[];
  tickers?: Record<string, Ticker>;
  wallet?: string | null;
}

interface NewsItem {
  title: string; url?: string; link?: string;
  source: { title?: string } | string;
  published_at?: string; pubDate?: string;
  currencies?: { code: string }[];
  image?: string; urlToImage?: string;
  category?: string;
}

interface CalEvent {
  title: string; country: string; date: string; time: string;
  impact: string; forecast?: string; previous?: string; actual?: string;
  currency?: string;
}

const COLORS = ['#00b4d8','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
const FLAG: Record<string, string> = { USD: '🇺🇸', EUR: '🇪🇺', JPY: '🇯🇵', CNY: '🇨🇳', GBP: '🇬🇧', AUD: '🇦🇺', CAD: '🇨🇦', NZD: '🇳🇿', CHF: '🇨🇭' };

function fmtLarge(v: number) {
  if (v >= 1e9) return '$' + fmt(v / 1e9, 2) + 'B';
  if (v >= 1e6) return '$' + fmt(v / 1e6, 2) + 'M';
  if (v >= 1e3) return '$' + fmt(v / 1e3, 1) + 'K';
  return '$' + fmt(v, 2);
}

const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border2)',
  borderRadius: 8, fontSize: 11,
  color: 'var(--text1)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
};

/* ─── AI Assistant collapsible section ─── */
export function Analytics({ markets: propMarkets, tickers: propTickers }: AnalyticsProps) {
  // Self-fetch markets/tickers if not provided via props
  const [selfMarkets, setSelfMarkets] = useState<Market[]>([]);
  const [selfTickers, setSelfTickers] = useState<Record<string, Ticker>>({});
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (propMarkets && propMarkets.length > 0) {
      setSelfMarkets(propMarkets);
      setSelfTickers(propTickers || {});
      setDataLoading(false);
      return;
    }
    // Fetch directly from Pacifica API
    async function load() {
      try {
        const [mRes, tRes] = await Promise.all([
          fetch('/api/proxy?path=' + encodeURIComponent('info')),
          fetch('/api/proxy?path=' + encodeURIComponent('info/prices')),
        ]);
        const mData = await mRes.json();
        const tData = await tRes.json();
        if (mData.success && Array.isArray(mData.data)) setSelfMarkets(mData.data);
        if (tData.success && Array.isArray(tData.data)) {
          const map: Record<string, Ticker> = {};
          (tData.data as Ticker[]).forEach((t) => { if (t.symbol) map[t.symbol] = t; });
          setSelfTickers(map);
        }
      } catch {}
      finally { setDataLoading(false); }
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [propMarkets, propTickers]);

  const markets = selfMarkets.length > 0 ? selfMarkets : (propMarkets || []);
  const tickers = Object.keys(selfTickers).length > 0 ? selfTickers : (propTickers || {});

  // Market Signals — OI/Funding alerts
  const { whaleTrades, oiAlerts, fundingAlerts, isScanning, lastScan } = useWhaleWatcher(markets, tickers, 1_000);

  // TTL filter: keep signals from last 3 hours only
  const TTL_MS = 3 * 60 * 60 * 1000;
  const [now3h, setNow3h] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow3h(Date.now()), 60_000); // re-check every minute
    return () => clearInterval(iv);
  }, []);
  const oiAlertsLive      = oiAlerts.filter(a => now3h - a.ts < TTL_MS).sort((a, b) => b.ts - a.ts);
  const fundingAlertsLive = fundingAlerts.filter(a => now3h - a.ts < TTL_MS).sort((a, b) => b.ts - a.ts);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calUnavailable, setCalUnavailable] = useState(false);
  const [newsFilter, setNewsFilter] = useState<'All' | 'Crypto' | 'Macro'>('All');
  const [calFilter, setCalFilter] = useState('Global');
  const [newsLoading, setNewsLoading] = useState(true);
  const [calLoading, setCalLoading] = useState(true);

  // CoinGecko global market data
  interface GlobalData {
    total_market_cap_usd: number;
    total_volume_usd: number;
    market_cap_change_24h: number;
    btc_dominance: number;
    eth_dominance: number;
    active_cryptocurrencies: number;
    markets: number;
  }
  const [globalData, setGlobalData] = useState<GlobalData | null>(null);

  useEffect(() => {
    async function loadGlobal() {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/global', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const d = json?.data;
        if (!d) return;
        setGlobalData({
          total_market_cap_usd: d.total_market_cap?.usd || 0,
          total_volume_usd: d.total_volume?.usd || 0,
          market_cap_change_24h: d.market_cap_change_percentage_24h_usd || 0,
          btc_dominance: d.market_cap_percentage?.btc || 0,
          eth_dominance: d.market_cap_percentage?.eth || 0,
          active_cryptocurrencies: d.active_cryptocurrencies || 0,
          markets: d.markets || 0,
        });
      } catch {}
    }
    loadGlobal();
    const iv = setInterval(loadGlobal, 120000);
    return () => clearInterval(iv);
  }, []);
  

  // Fetch news
  useEffect(() => {
    async function load() {
      setNewsLoading(true);
      try {
        const res = await fetch('/api/news');
        if (!res.ok) return;
        const data = await res.json();
        const items: NewsItem[] = data.results || data.data || [];
        setNews(items.slice(0, 40));
      } catch {} finally { setNewsLoading(false); }
    }
    load();
    const iv = setInterval(load, 120000);
    return () => clearInterval(iv);
  }, []);

  // Fetch calendar
  useEffect(() => {
    async function load() {
      setCalLoading(true);
      try {
        const res = await fetch('/api/calendar');
        if (!res.ok) return;
        // Server sets this header when all upstream sources failed
        if (res.headers.get('X-Calendar-Source') === 'unavailable') {
          setCalUnavailable(true);
          setCalEvents([]);
          return;
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          setCalUnavailable(data.length === 0);
          setCalEvents(data.slice(0, 60).map((e: Record<string, string>) => ({
            // ForexFactory fields: title, country, date, time, impact, forecast, previous, actual
            // Fallback fields: event, name, currency
            title: e.title || e.event || e.name || '',
            country: e.country || e.currency || '',
            currency: e.currency || e.country || '',
            date: e.date || '',
            time: e.time || '',
            // ForexFactory impact: 'High', 'Medium', 'Low', 'Holiday'
            impact: e.impact === 'High' ? '3' : e.impact === 'Medium' ? '2' : e.impact === 'Low' ? '1' : (e.impact || '1'),
            forecast: e.forecast || '',
            previous: e.previous || '',
            actual: e.actual || '',
          })));
        }
      } catch {} finally { setCalLoading(false); }
    }
    load();
    const iv = setInterval(load, 300000);
    return () => clearInterval(iv);
  }, []);


  // Computed market stats
  const totalVolume = Object.values(tickers).reduce((s, t) => s + Number(t?.volume_24h || 0), 0);
  const totalOI = Object.values(tickers).reduce((s, t) => s + Number(t?.open_interest || 0), 0);
  const activeMarkets = markets.length;

  const topByVolume = [...markets]
    .map(m => ({ symbol: m.symbol, volume: Number(tickers[m.symbol]?.volume_24h || 0) }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  const topByOI = [...markets]
    .map(m => ({ symbol: m.symbol, oi: Number(tickers[m.symbol]?.open_interest || 0), value: Number(tickers[m.symbol]?.open_interest || 0) }))
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 10);

  const fundingData = [...markets]
    .map(m => ({ symbol: m.symbol, funding: Number(tickers[m.symbol]?.funding || 0) * 100 }))
    .filter(d => Math.abs(d.funding) > 0)
    .sort((a, b) => Math.abs(b.funding) - Math.abs(a.funding))
    .slice(0, 12);


  const volDominance = topByVolume.slice(0, 8).map(m => ({
    name: m.symbol, value: m.volume,
    pct: totalVolume > 0 ? (m.volume / totalVolume * 100) : 0,
  }));



  // Long/Short ratio from funding bias — sorted by 24h volume (BTC/ETH first)
  const longShortData = [...markets]
    .map(m => {
      const tk = tickers[m.symbol];
      const volume = Number(tk?.volume_24h || 0);
      const funding = Number(tk?.funding || 0);
      if (volume <= 0) return null;
      const longRatio = funding >= 0
        ? 0.5 + Math.min(Math.abs(funding) * 500, 0.35)
        : 0.5 - Math.min(Math.abs(funding) * 500, 0.35);
      const longVol = volume * longRatio;
      const shortVol = volume * (1 - longRatio);
      return {
        symbol: m.symbol,
        long: Math.round(longRatio * 100),
        short: Math.round((1 - longRatio) * 100),
        volume,
        longVol,
        shortVol,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.volume - a!.volume) as { symbol: string; long: number; short: number; volume: number; longVol: number; shortVol: number }[];

  // All markets funding rate — sorted for heatmap
  const allFundingData = [...markets]
    .map(m => ({
      symbol: m.symbol,
      funding: Number(tickers[m.symbol]?.funding || 0) * 100,
      oi: Number(tickers[m.symbol]?.open_interest || 0),
    }))
    .filter(d => d.oi > 0)
    .sort((a, b) => b.oi - a.oi)
    ;  // all markets

  const filteredNews = newsFilter === 'All' ? news :
    news.filter(n => {
      const cats = (n.category || '').toLowerCase();
      if (newsFilter === 'Crypto') return !cats.includes('macro') && !cats.includes('equit');
      if (newsFilter === 'Macro') return cats.includes('macro') || cats.includes('policy');
      return true;
    });

  const filteredCal = calFilter === 'Global' ? calEvents :
    calEvents.filter(e => e.country === calFilter || e.currency === calFilter);

  if (dataLoading && markets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-3 bg-bg">
        <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
        <span className="text-[13px] text-text3">Loading market data...</span>
      </div>
    );
  }

  const NAV_ITEMS = [
    { id: 'ai-assistant',      label: 'AI Assistant',                icon: '🤖', desc: 'Ask questions, analyze coins, get trade ideas' },
    { id: 'market-overview',   label: 'Market Overview',             icon: '📊', desc: 'Volume, OI, active markets — live Pacifica snapshot' },
    { id: 'oi-distribution',   label: 'OI Distribution',             icon: '🔮', desc: 'OI split across markets. Where capital is concentrated' },
    { id: 'funding-extreme',   label: 'Funding Rates — Extreme',     icon: '⚡', desc: 'Highest/lowest funding rates. Crowded positions signal' },
    { id: 'long-short-ratio',  label: 'Long / Short Ratio',          icon: '⚖️',  desc: 'Long vs short bias per market, from funding rate direction' },
    { id: 'all-funding',       label: 'All Markets Funding Rate',    icon: '🌡️',  desc: 'Color-coded funding heatmap across all markets' },
    { id: 'market-signals',    label: 'Market Signals',              icon: '🚨', desc: 'Real-time OI spikes and funding anomalies' },
    { id: 'liquidation-monitor', label: 'Liquidation Monitor',       icon: '💧', desc: 'Liq volumes from HyperLiquid + Pacifica DEX' },
  ];

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-full bg-bg overflow-hidden">

      {/* ─── FAR LEFT: Navigation Sidebar ─── */}
      <div className="w-56 shrink-0 border-r border-border1 flex flex-col bg-surface overflow-y-auto">
        <div className="px-3 py-3 border-b border-border1">
          <div className="text-[10px] font-bold text-text3 uppercase tracking-wider">Sections</div>
        </div>
        <div className="flex-1 py-2">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => scrollTo(item.id)}
              className="w-full text-left px-3 py-2.5 hover:bg-surface2 transition-colors group border-b border-border1/40 last:border-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[12px]">{item.icon}</span>
                <span className="text-[11px] font-semibold text-text2 group-hover:text-accent leading-tight transition-colors">{item.label}</span>
              </div>
              <div className="text-[9px] text-text3 leading-snug pl-5">{item.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ─── CENTER: Market Analytics ─── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[860px] mx-auto px-5 py-5 space-y-5">

          {/* AI Assistant */}
          <div id="ai-assistant" className="bg-surface border border-border1 rounded-xl overflow-hidden" style={{ minHeight: 44 }}>
            <AiAssistant tickers={tickers} />
          </div>

          {/* Stat cards */}
          <div id="market-overview" className="grid grid-cols-4 gap-3">
            {[
              { icon: '📊', label: '24h Volume', value: fmtLarge(totalVolume), sub: 'across all markets', color: 'text-accent' },
              { icon: '🔮', label: 'Open Interest', value: fmtLarge(totalOI), sub: 'across all markets', color: 'text-success' },
              { icon: '📈', label: 'Active Markets', value: String(activeMarkets), sub: 'perpetuals', color: 'text-warn' },
              { icon: '🏆', label: 'Top Volume', value: topByVolume[0]?.symbol || '—', sub: topByVolume[0] ? fmtLarge(topByVolume[0].volume) : '', color: 'text-accent' },
            ].map(s => (
              <div key={s.label} className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[16px]">{s.icon}</span>
                  <span className="text-[10px] text-text3 uppercase font-semibold tracking-wide">{s.label}</span>
                </div>
                <div className={`text-[22px] font-bold leading-none ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-text3 mt-1">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Volume by Market */}
          <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
            <div className="flex justify-between items-center mb-4">
              <div className="text-[12px] font-bold text-text1">Volume by Market (24h)</div>
              <div className="text-[10px] text-text3">Top 10</div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topByVolume} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text2)' }} tickLine={false} axisLine={false}
                  tickFormatter={v => fmtLarge(v)} />
                <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11, fill: 'var(--text1)', fontWeight: 600 }} tickLine={false} axisLine={false} width={52} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmtLarge(v), 'Volume']} />
                <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                  {topByVolume.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* OI Distribution + Volume Dominance */}
          <div id="oi-distribution" className="grid grid-cols-2 gap-4">
            {/* OI Donut */}
            <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="text-[12px] font-bold text-text1 mb-3">OI Distribution</div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <PieChart width={140} height={140}>
                    <Pie data={topByOI.slice(0, 8)} cx={65} cy={65} innerRadius={40} outerRadius={65}
                      dataKey="oi" stroke="none">
                      {topByOI.slice(0, 8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmtLarge(v), 'OI']} />
                  </PieChart>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <div className="text-[9px] text-text3 leading-none">OI</div>
                      <div className="text-[10px] font-bold text-text1 leading-tight">{fmtLarge(totalOI)}</div>
                    </div>
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  {topByOI.slice(0, 6).map((m, i) => (
                    <div key={m.symbol} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i] }} />
                      <span className="text-text2 font-semibold">{m.symbol}</span>
                      <span className="text-text3 ml-auto">{totalOI > 0 ? (m.oi / totalOI * 100).toFixed(1) + '%' : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Volume Dominance */}
            <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="text-[12px] font-bold text-text1 mb-3">24h Volume Dominance</div>
              <div className="space-y-2">
                {volDominance.slice(0, 6).map((m, i) => (
                  <div key={m.name} className="flex items-center gap-2">
                    <CoinLogo symbol={m.name} size={16} />
                    <span className="text-[11px] font-semibold text-text1 w-12">{m.name}</span>
                    <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: COLORS[i] }} />
                    </div>
                    <span className="text-[10px] text-text3 w-10 text-right">{m.pct.toFixed(1)}%</span>
                    <span className="text-[10px] text-text3 w-14 text-right font-mono">{fmtLarge(m.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Funding Rates + Long/Short — yan yana */}
          <div className="grid grid-cols-2 gap-4">
            {/* Funding Rates Most Extreme */}
            <div id="funding-extreme" className="bg-surface border border-border1 rounded-xl shadow-card">
              <div className="px-4 pt-3 pb-0">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-[12px] font-bold text-text1">Funding Rates — Extreme</div>
                </div>
                <div className="flex items-center gap-3 text-[9px] text-text3 mb-2">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-success inline-block" /> Positive</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" /> Negative</span>
                </div>
              </div>
              <div className="px-3 pb-3">
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={fundingData} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                    <XAxis dataKey="symbol" tick={{ fontSize: 8, fill: 'var(--text2)' }} tickLine={false} axisLine={false}
                      tickFormatter={(v: string) => v.length > 5 ? v.slice(0,5) + '..' : v} />
                    <YAxis tick={{ fontSize: 8, fill: 'var(--text2)' }} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) => v.toFixed(3) + '%'} width={48} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(4) + '%', 'Funding/hr']} />
                    <Bar dataKey="funding" radius={[3, 3, 0, 0]}>
                      {fundingData.map((_d: {funding: number}, i: number) => <Cell key={i} fill={_d.funding >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Long/Short Ratio */}
            <div id="long-short-ratio" className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <div className="text-[12px] font-bold text-text1">Long / Short Ratio</div>
                  <div className="text-[9px] text-text3 mt-0.5">Estimated from funding rate bias</div>
                </div>
                <div className="flex items-center gap-2 text-[9px] text-text3">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-success inline-block" /> L</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" /> S</span>
                </div>
              </div>
              <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 180 }}>
                {longShortData.map((m: {symbol: string; long: number; short: number; longVol: number; shortVol: number; volume: number}, idx: number) => (
                  <div key={m.symbol} className="flex items-center gap-2 relative group">
                    <div className="flex items-center gap-1.5 w-14 shrink-0">
                      <CoinLogo symbol={m.symbol} size={12} />
                      <span className="text-[10px] font-semibold text-text1 truncate">{m.symbol}</span>
                    </div>
                    <div className="flex-1 h-3 rounded-full overflow-hidden flex">
                      <div className="h-full bg-success/70 transition-all" style={{ width: `${m.long}%` }} />
                      <div className="h-full bg-danger/70 transition-all" style={{ width: `${m.short}%` }} />
                    </div>
                    <span className="text-[9px] font-mono text-success w-6 text-right shrink-0">{m.long}%</span>
                    <span className="text-[9px] font-mono text-danger w-6 text-right shrink-0">{m.short}%</span>
                    <div className={`absolute left-14 hidden group-hover:flex flex-col bg-surface border border-border1 rounded-xl shadow-card-md px-3 py-2.5 z-[100] min-w-[160px] pointer-events-none ${idx < 4 ? 'top-full mt-1' : 'bottom-6'}`}>
                      <div className="text-[11px] font-bold text-text1 mb-1.5">{m.symbol}</div>
                      <div className="flex items-center justify-between gap-4 text-[10px] mb-1">
                        <span className="text-success">Long</span>
                        <span className="font-mono font-bold text-success">{fmtLarge(m.longVol)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-[10px] mb-1.5">
                        <span className="text-danger">Short</span>
                        <span className="font-mono font-bold text-danger">{fmtLarge(m.shortVol)}</span>
                      </div>
                      <div className="text-[9px] text-text3 border-t border-border1 pt-1.5">
                        Vol: {fmtLarge(m.volume)} · est. from funding
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* All Markets Funding Rate Heatmap */}
          <div id="all-funding" className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[12px] font-bold text-text1">All Markets Funding Rate</div>
              <div className="text-[10px] text-text3">Live snapshot · updates every 30s</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allFundingData.map(m => {
                const absF = Math.abs(m.funding);
                const intensity = Math.min(absF / 0.05, 1);
                const isPos = m.funding >= 0;
                const bg = isPos
                  ? `rgba(16,185,129,${0.1 + intensity * 0.7})`
                  : `rgba(239,68,68,${0.1 + intensity * 0.7})`;
                // Yüksek intensity'de text beyaz olsun, okunabilirlik için
                const textColor = intensity > 0.5 ? '#fff' : undefined;
                const numColor  = intensity > 0.5 ? '#fff' : (isPos ? 'var(--success)' : 'var(--danger)');
                return (
                  <div key={m.symbol} title={`${m.symbol}: ${m.funding.toFixed(4)}%/hr`}
                    className="flex flex-col items-center px-2 py-1.5 rounded-lg cursor-default transition-all hover:opacity-80"
                    style={{ background: bg, minWidth: 52 }}>
                    <CoinLogo symbol={m.symbol} size={14} />
                    <span className="text-[9px] font-bold mt-0.5" style={{ color: textColor ?? 'var(--text1)' }}>{m.symbol}</span>
                    <span className="text-[9px] font-mono font-bold" style={{ color: numColor }}>
                      {isPos ? '+' : ''}{m.funding.toFixed(4)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── Market Signals ─── */}
          <div id="market-signals" className="bg-surface border border-border1 rounded-xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-[12px] font-bold text-text1">Market Signals</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-text3">
                {isScanning && <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />}
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-border1">
              {/* OI Alerts */}
              <div>
                <div className="px-4 py-2.5 border-b border-border1 bg-surface2/40">
                  <h4 className="text-[11px] font-bold text-text1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />OI Alerts ({oiAlertsLive.length})
                  </h4>
                </div>
                <div className="overflow-auto" style={{ maxHeight: 200 }}>
                  {oiAlertsLive.length > 0 ? oiAlertsLive.map((a, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-border1 last:border-0 hover:bg-surface2/40">
                      <div className="flex items-center gap-2"><CoinLogo symbol={a.symbol} size={16} /><span className="font-semibold text-[11px]">{a.symbol}</span></div>
                      <span className={`text-[11px] font-bold ${a.direction === 'up' ? 'text-success' : 'text-danger'}`}>
                        {a.direction === 'up' ? '↑' : '↓'} {fmt(Math.abs(a.changePercent), 1)}%
                      </span>
                      <span className="text-[10px] text-text3">{new Date(a.ts).toLocaleTimeString()}</span>
                    </div>
                  )) : <div className="py-6 text-center text-text3 text-[11px]">No OI spikes</div>}
                </div>
              </div>
              {/* Funding Spikes */}
              <div>
                <div className="px-4 py-2.5 border-b border-border1 bg-surface2/40">
                  <h4 className="text-[11px] font-bold text-text1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-warn" />Funding Spikes ({fundingAlertsLive.length})
                  </h4>
                </div>
                <div className="overflow-auto" style={{ maxHeight: 200 }}>
                  {fundingAlertsLive.length > 0 ? fundingAlertsLive.map((a, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-border1 last:border-0 hover:bg-surface2/40">
                      <div className="flex items-center gap-2"><CoinLogo symbol={a.symbol} size={16} /><span className="font-semibold text-[11px]">{a.symbol}</span></div>
                      <span className={`text-[11px] font-bold ${a.rate >= 0 ? 'text-danger' : 'text-success'}`}>
                        {a.rate >= 0 ? '+' : ''}{fmt(a.rate, 4)}%/8h
                      </span>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${Math.abs(a.rate) >= 0.1 ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn'}`}>
                        {Math.abs(a.rate) >= 0.1 ? 'HIGH' : 'SPIKE'}
                      </span>
                    </div>
                  )) : <div className="py-6 text-center text-text3 text-[11px]">No funding spikes detected yet</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Estimated Liquidation Heatmap */}
          <div id="liquidation-monitor">
            <HeatmapView markets={markets} />
          </div>

        </div> {/* max-w-[860px] konteynerini kapatır */}
      </div>   {/* CENTER panel kapanır */}

      {/* ─── RIGHT: News + Calendar ─── */}
      <div className="w-[320px] shrink-0 border-l border-border1 flex flex-col min-h-0">

        {/* News */}
        <div className="flex-1 flex flex-col overflow-hidden border-b border-border1" style={{ flex: '1 1 0' }}>
          <div className="px-3 py-2.5 border-b border-border1 bg-surface shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] font-bold text-text1">Global News</div>
              {newsLoading && <div className="w-3 h-3 border border-border2 border-t-accent rounded-full animate-spin" />}
            </div>
            {/* CoinGecko global stats strip */}
            {globalData && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 pb-2 border-b border-border1">
                <span className="text-[10px] text-text3">
                  MCap: <span className="text-text2 font-semibold">{fmtLarge(globalData.total_market_cap_usd)}</span>
                  <span className={`ml-1 font-semibold ${globalData.market_cap_change_24h >= 0 ? 'text-success' : 'text-danger'}`}>
                    {globalData.market_cap_change_24h >= 0 ? '+' : ''}{globalData.market_cap_change_24h.toFixed(2)}%
                  </span>
                </span>
                <span className="text-[10px] text-text3">
                  Vol: <span className="text-text2 font-semibold">{fmtLarge(globalData.total_volume_usd)}</span>
                </span>
                <span className="text-[10px] text-text3">
                  BTC Dom: <span className="text-warn font-semibold">{globalData.btc_dominance.toFixed(1)}%</span>
                </span>
                <span className="text-[10px] text-text3">
                  ETH Dom: <span className="text-accent font-semibold">{globalData.eth_dominance.toFixed(1)}%</span>
                </span>
              </div>
            )}
            <div className="flex gap-1">
              {(['All', 'Crypto', 'Macro'] as const).map(f => (
                <button key={f} onClick={() => setNewsFilter(f)}
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-all ${newsFilter === f ? 'bg-accent text-white' : 'bg-surface2 text-text3 hover:text-text2 border border-border1'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {newsLoading && news.length === 0 && (
              <div className="py-8 flex flex-col items-center gap-2">
                <div className="w-4 h-4 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-[11px] text-text3">Loading news...</span>
              </div>
            )}
            {filteredNews.length === 0 && !newsLoading && (
              <div className="py-8 text-center text-[11px] text-text3">No news available</div>
            )}
            {filteredNews.map((n, i) => {
              const url = n.url || (n as {link?: string}).link || '#';
              const source = typeof n.source === 'object' ? (n.source as {title?: string})?.title : String(n.source || 'News');
              const img = (n as {image?: string; urlToImage?: string}).image || n.urlToImage;
              const ago = (() => {
                const d = new Date(n.published_at || (n as {pubDate?: string}).pubDate || '');
                if (isNaN(d.getTime())) return '';
                const diff = Math.floor((Date.now() - d.getTime()) / 60000);
                if (diff < 60) return `${diff}m ago`;
                if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
                return `${Math.floor(diff / 1440)}d ago`;
              })();
              return (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex gap-2.5 px-3 py-2.5 border-b border-border1 hover:bg-surface2/50 transition-colors group">
                  {img && (
                    <img src={img} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0 bg-surface2"
                      onError={e => (e.currentTarget.style.display = 'none')} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-text1 leading-snug mb-1.5 group-hover:text-accent transition-colors line-clamp-2">{n.title}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-text3">{source || 'News'}</span>
                      {ago && <span className="text-[9px] text-text3">· {ago}</span>}
                      {n.currencies?.slice(0, 3).map(c => (
                        <span key={c.code} className="px-1 py-0.5 rounded bg-accent/10 border border-accent/20 text-[9px] text-accent font-semibold">{c.code}</span>
                      ))}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>

        {/* Calendar */}
        <div className="flex flex-col overflow-hidden" style={{ flex: '1 1 0' }}>
          <div className="px-3 py-2.5 border-b border-border1 bg-surface shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] font-bold text-text1">Economic Calendar</div>
              {calLoading && <div className="w-3 h-3 border border-border2 border-t-accent rounded-full animate-spin" />}
            </div>
            <div className="flex gap-1 flex-wrap">
              {['Global','USD','EUR','JPY','GBP','CNY'].map(f => (
                <button key={f} onClick={() => setCalFilter(f)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${calFilter === f ? 'bg-accent text-white' : 'bg-surface2 text-text3 hover:text-text2 border border-border1'}`}>
                  {f === 'Global' ? 'Global' : `${FLAG[f] || ''} ${f}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredCal.length === 0 ? (
              <div className="py-8 text-center text-[11px] text-text3">
                {calLoading ? 'Loading calendar...' : calUnavailable ? '⚠️ Calendar source unavailable — try again later' : 'No events available'}
              </div>
            ) : (() => {
              let lastDate = '';
              return filteredCal.map((ev, i) => {
                const dateStr = ev.date
                  ? new Date(ev.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
                  : '';
                const showDate = dateStr !== lastDate;
                if (showDate) lastDate = dateStr;
                const impact = Number(ev.impact) || 1;
                const impactColor = impact >= 3 ? 'bg-danger' : impact === 2 ? 'bg-warn' : 'bg-success/60';
                return (
                  <div key={i}>
                    {showDate && dateStr && (
                      <div className="px-3 py-1 text-[9px] font-bold text-text3 uppercase tracking-wider bg-surface2/60 border-b border-border1 sticky top-0">
                        {dateStr}
                      </div>
                    )}
                    <div className="flex items-start gap-2.5 px-3 py-2 border-b border-border1 hover:bg-surface2/40 transition-colors">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${impactColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-text1 leading-snug">{ev.title}</div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text3">
                          <span>{FLAG[ev.currency || ev.country] || ''} {ev.currency || ev.country}</span>
                          {ev.time && <span>{ev.time} UTC</span>}
                        </div>
                        {(ev.forecast || ev.previous) && (
                          <div className="text-[10px] text-text3 mt-0.5">
                            {ev.forecast && <span>F: <span className="text-text2">{ev.forecast}</span> </span>}
                            {ev.previous && <span>P: <span className="text-text2">{ev.previous}</span></span>}
                            {ev.actual && <span> A: <span className="text-success font-semibold">{ev.actual}</span></span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

      </div>
    </div>
  );
}
