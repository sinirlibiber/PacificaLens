'use client';

import { useState, useEffect } from 'react';
import { Market, Ticker } from '@/lib/pacifica';
import { fmt, fmtPrice } from '@/lib/utils';
import { CoinLogo } from './CoinLogo';
import AiAssistant from './AiAssistant';
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
  border: '1px solid var(--border1)',
  borderRadius: 8, fontSize: 11,
  color: 'var(--text1)',
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
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [propMarkets, propTickers]);

  const markets = selfMarkets.length > 0 ? selfMarkets : (propMarkets || []);
  const tickers = Object.keys(selfTickers).length > 0 ? selfTickers : (propTickers || {});

  const [news, setNews] = useState<NewsItem[]>([]);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
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
  
  // Liquidations state
  interface LiqEvent { symbol: string; side: string; price: string; amount: string; created_at: number; cause?: string; event_type?: string; }
  const [liquidations, setLiquidations] = useState<LiqEvent[]>([]);

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
        const data = await res.json();
        if (Array.isArray(data)) {
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

  // Fetch liquidations from top markets
  useEffect(() => {
    if (markets.length === 0) return;
    async function loadLiqs() {
      const topSymbols = [...markets]
        .sort((a, b) => Number(tickers[b.symbol]?.open_interest || 0) - Number(tickers[a.symbol]?.open_interest || 0))
        .slice(0, 5)
        .map(m => m.symbol);
      const results: LiqEvent[] = [];
      await Promise.all(topSymbols.map(async sym => {
        try {
          const res = await fetch(`/api/proxy?path=${encodeURIComponent('trades?symbol=' + sym)}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.success && Array.isArray(data.data)) {
            // Filter for liquidations — try multiple field names
            const liqs = data.data.filter((t: {cause?: string; event_type?: string; type?: string}) =>
              t.cause === 'market_liquidation' ||
              t.cause === 'backstop_liquidation' ||
              t.event_type === 'liquidation' ||
              t.type === 'liquidation'
            );
            // If no liquidations found, take largest trades as proxy
            const items = liqs.length > 0 ? liqs : [];
            items.forEach((t: LiqEvent) => results.push({ ...t, symbol: sym }));
          }
        } catch {}
      }));
      results.sort((a, b) => b.created_at - a.created_at);
      setLiquidations(results.slice(0, 50));
    }
    loadLiqs();
    const iv = setInterval(loadLiqs, 15000);
    return () => clearInterval(iv);
  }, [markets, tickers]);

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

  // Liquidation stats
  const totalLiqValue = liquidations.reduce((s, l) => s + Number(l.price) * Number(l.amount), 0);
  const liqBySymbol = liquidations.reduce((acc, l) => {
    const key = l.symbol;
    if (!acc[key]) acc[key] = { symbol: key, count: 0, value: 0 };
    acc[key].count++;
    acc[key].value += Number(l.price) * Number(l.amount);
    return acc;
  }, {} as Record<string, { symbol: string; count: number; value: number }>);
  const liqHeatmap = Object.values(liqBySymbol).sort((a, b) => b.value - a.value);

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

  return (
    <div className="flex h-full bg-bg overflow-hidden">

      {/* ─── LEFT: Market Analytics ─── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[920px] mx-auto px-6 py-5 space-y-5">

          {/* AI Assistant */}
          <div className="bg-surface border border-border1 rounded-xl overflow-hidden" style={{ minHeight: 44 }}>
            <AiAssistant />
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-3">
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
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                  tickFormatter={v => fmtLarge(v)} />
                <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} tickLine={false} axisLine={false} width={52} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmtLarge(v), 'Volume']} />
                <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                  {topByVolume.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* OI Distribution + Volume Dominance */}
          <div className="grid grid-cols-2 gap-4">
            {/* OI Donut */}
            <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="text-[12px] font-bold text-text1 mb-3">OI Distribution</div>
              <div className="flex items-center gap-4">
                <PieChart width={140} height={140}>
                  <Pie data={topByOI.slice(0, 8)} cx={65} cy={65} innerRadius={40} outerRadius={65}
                    dataKey="oi" stroke="none">
                    {topByOI.slice(0, 8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmtLarge(v), 'OI']} />
                </PieChart>
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

          {/* Funding Rates (top extreme) */}
          <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[12px] font-bold text-text1">Funding Rates — Most Extreme</div>
              <div className="flex items-center gap-3 text-[10px] text-text3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" /> Positive (longs pay)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger inline-block" /> Negative (shorts pay)</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={fundingData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <XAxis dataKey="symbol" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                  tickFormatter={v => v.toFixed(3) + '%'} width={56} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(4) + '%', 'Funding/hr']} />
                <Bar dataKey="funding" radius={[3, 3, 0, 0]}>
                  {fundingData.map((d, i) => <Cell key={i} fill={d.funding >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Long/Short Ratio */}
          <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[12px] font-bold text-text1">Long / Short Ratio</div>
              <div className="flex items-center gap-3 text-[10px] text-text3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" /> Long</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger inline-block" /> Short</span>
                <span>· funding bias</span>
              </div>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto overflow-x-visible pr-1" style={{ overflowY: "auto", overflowX: "visible" }}>
              {longShortData.map((m, idx) => (
                <div key={m.symbol} className="flex items-center gap-2 relative group">
                  <div className="flex items-center gap-1.5 w-16 shrink-0">
                    <CoinLogo symbol={m.symbol} size={14} />
                    <span className="text-[11px] font-semibold text-text1 truncate">{m.symbol}</span>
                  </div>
                  <div className="flex-1 h-3.5 rounded-full overflow-hidden flex cursor-pointer">
                    <div className="h-full bg-success/70 transition-all" style={{ width: `${m.long}%` }} />
                    <div className="h-full bg-danger/70 transition-all" style={{ width: `${m.short}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-success w-7 text-right shrink-0">{m.long}%</span>
                  <span className="text-[10px] font-mono text-danger w-7 text-right shrink-0">{m.short}%</span>
                  {/* Tooltip — top 5 show below, rest show above */}
                  <div className={`absolute left-16 hidden group-hover:flex flex-col bg-surface border border-border1 rounded-xl shadow-card-md px-3 py-2.5 z-[100] min-w-[180px] pointer-events-none ${idx < 5 ? 'top-full mt-1' : 'bottom-6'}`}>
                    <div className="text-[11px] font-bold text-text1 mb-1.5">{m.symbol}</div>
                    <div className="flex items-center justify-between gap-6 text-[10px] mb-1">
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success inline-block" />Long</span>
                      <span className="font-mono font-bold text-success">{fmtLarge(m.longVol)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-6 text-[10px] mb-1.5">
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger inline-block" />Short</span>
                      <span className="font-mono font-bold text-danger">{fmtLarge(m.shortVol)}</span>
                    </div>
                    <div className="text-[9px] text-text3 border-t border-border1 pt-1.5">
                      Total 24h vol: {fmtLarge(m.volume)} · est. from funding
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* All Markets Funding Rate Heatmap */}
          <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
            <div className="text-[12px] font-bold text-text1 mb-3">All Markets Funding Rate</div>
            <div className="flex flex-wrap gap-1.5">
              {allFundingData.map(m => {
                const absF = Math.abs(m.funding);
                const intensity = Math.min(absF / 0.05, 1);
                const isPos = m.funding >= 0;
                const bg = isPos
                  ? `rgba(16,185,129,${0.1 + intensity * 0.7})`
                  : `rgba(239,68,68,${0.1 + intensity * 0.7})`;
                return (
                  <div key={m.symbol} title={`${m.symbol}: ${m.funding.toFixed(4)}%/hr`}
                    className="flex flex-col items-center px-2 py-1.5 rounded-lg cursor-default transition-all hover:opacity-80"
                    style={{ background: bg, minWidth: 52 }}>
                    <CoinLogo symbol={m.symbol} size={14} />
                    <span className="text-[9px] font-bold text-text1 mt-0.5">{m.symbol}</span>
                    <span className={`text-[9px] font-mono font-bold ${isPos ? 'text-success' : 'text-danger'}`}>
                      {isPos ? '+' : ''}{m.funding.toFixed(4)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Total Liquidations + Heatmap */}
          <div className="grid grid-cols-2 gap-4">
            {/* Recent Liquidations */}
            <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="flex justify-between items-center mb-3">
                <div className="text-[12px] font-bold text-text1">Recent Liquidations</div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${totalLiqValue > 0 ? 'bg-danger/10 text-danger' : 'bg-surface2 text-text3'}`}>
                  {totalLiqValue > 0 ? fmtLarge(totalLiqValue) + ' liquidated' : 'No liquidations'}
                </span>
              </div>
              {liquidations.length === 0 ? (
                <div className="py-8 text-center space-y-1">
                  <div className="text-[13px]">✓</div>
                  <div className="text-[11px] text-text3">No liquidations in top 5 markets</div>
                  <div className="text-[10px] text-text3">Updates every 15 seconds</div>
                </div>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {liquidations.slice(0, 15).map((l, i) => {
                    const isLong = l.side?.includes('long');
                    const value = Number(l.price) * Number(l.amount);
                    return (
                      <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2/50 transition-colors">
                        <CoinLogo symbol={l.symbol} size={16} />
                        <span className="text-[11px] font-semibold text-text1 w-12">{l.symbol}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isLong ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                          {isLong ? 'LONG LIQ' : 'SHORT LIQ'}
                        </span>
                        <span className="text-[10px] font-mono text-text2 ml-auto">{fmtLarge(value)}</span>
                        <span className="text-[10px] text-text3">{new Date(l.created_at).toLocaleTimeString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Liquidation Heatmap */}
            <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="text-[12px] font-bold text-text1 mb-3">Liquidation Heatmap</div>
              {liqHeatmap.length === 0 ? (
                <div className="py-8 text-center text-[11px] text-text3">No liquidation data available</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {liqHeatmap.map((l, i) => {
                    const maxVal = liqHeatmap[0]?.value || 1;
                    const intensity = Math.min(l.value / maxVal, 1);
                    const size = Math.max(52, intensity * 100);
                    return (
                      <div key={l.symbol} title={`${l.symbol}: ${l.count} liqs · ${fmtLarge(l.value)}`}
                        className="flex flex-col items-center justify-center rounded-xl cursor-default hover:opacity-80 transition-all"
                        style={{
                          width: size, height: size,
                          background: `rgba(239,68,68,${0.15 + intensity * 0.6})`,
                          border: '1px solid rgba(239,68,68,' + (0.2 + intensity * 0.5) + ')',
                        }}>
                        <CoinLogo symbol={l.symbol} size={Math.max(14, size * 0.28)} />
                        <span className="text-[9px] font-bold text-text1 mt-0.5">{l.symbol}</span>
                        <span className="text-[9px] text-danger font-mono">{fmtLarge(l.value)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

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
                {calLoading ? 'Loading calendar...' : 'No events available'}
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
