'use client';

import { useState, useEffect, useCallback } from 'react';
import { Market, Ticker, getMarkPrice, get24hChange } from '@/lib/pacifica';
import { fmt, fmtPrice } from '@/lib/utils';
import { CoinLogo } from './CoinLogo';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';

interface AnalyticsProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  wallet: string | null;
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
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border1)',
  borderRadius: 8, fontSize: 11,
  color: 'var(--color-text1)',
};

export function Analytics({ markets, tickers }: AnalyticsProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [newsFilter, setNewsFilter] = useState<'All' | 'Crypto' | 'Macro'>('All');
  const [calFilter, setCalFilter] = useState('Global');
  const [newsLoading, setNewsLoading] = useState(true);
  const [calLoading, setCalLoading] = useState(true);

  // Fetch news
  useEffect(() => {
    async function load() {
      setNewsLoading(true);
      try {
        const res = await fetch('/api/news');
        if (!res.ok) return;
        const data = await res.json();
        const items: NewsItem[] = data.results || data.data || [];
        setNews(items.slice(0, 30));
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
          setCalEvents(data.slice(0, 50).map((e: Record<string, string>) => ({
            title: e.title || e.event || e.name || '',
            country: e.country || e.currency || '',
            currency: e.currency || e.country || '',
            date: e.date || '',
            time: e.time || '',
            impact: e.impact || '1',
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

  const gainers = [...markets]
    .map(m => ({ symbol: m.symbol, change: get24hChange(tickers[m.symbol]), price: getMarkPrice(tickers[m.symbol]) }))
    .filter(m => m.price > 0)
    .sort((a, b) => b.change - a.change);
  const top5Gainers = gainers.slice(0, 5);
  const top5Losers = gainers.slice(-5).reverse();

  const volDominance = topByVolume.slice(0, 8).map(m => ({
    name: m.symbol, value: m.volume,
    pct: totalVolume > 0 ? (m.volume / totalVolume * 100) : 0,
  }));

  const filteredNews = newsFilter === 'All' ? news :
    news.filter(n => {
      const cats = (n.category || '').toLowerCase();
      if (newsFilter === 'Crypto') return !cats.includes('macro') && !cats.includes('equit');
      if (newsFilter === 'Macro') return cats.includes('macro') || cats.includes('policy');
      return true;
    });

  const filteredCal = calFilter === 'Global' ? calEvents :
    calEvents.filter(e => e.country === calFilter || e.currency === calFilter);

  return (
    <div className="flex h-full overflow-hidden bg-bg">

      {/* ─── LEFT: Market Analytics ─── */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-[920px] mx-auto px-6 py-5 space-y-5">

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
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topByVolume} layout="vertical" margin={{ left: 8, right: 20, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                  tickFormatter={v => fmtLarge(v)} />
                <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40} />
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

          {/* Funding Rates + Gainers/Losers */}
          <div className="grid grid-cols-2 gap-4">
            {/* Funding */}
            <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="text-[12px] font-bold text-text1 mb-3">Funding Rates</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={fundingData} margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                  <XAxis dataKey="symbol" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                    tickFormatter={v => v.toFixed(3) + '%'} width={52} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(4) + '%', 'Funding']} />
                  <Bar dataKey="funding" radius={[3, 3, 0, 0]}>
                    {fundingData.map((d, i) => <Cell key={i} fill={d.funding >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.8} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Gainers / Losers */}
            <div className="bg-surface border border-border1 rounded-xl p-4 shadow-card">
              <div className="grid grid-cols-2 gap-3 h-full">
                <div>
                  <div className="text-[11px] font-bold text-success mb-2">🚀 Top Gainers</div>
                  {top5Gainers.map(m => (
                    <div key={m.symbol} className="flex items-center justify-between py-1.5 border-b border-border1 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <CoinLogo symbol={m.symbol} size={16} />
                        <span className="text-[11px] font-semibold text-text1">{m.symbol}</span>
                      </div>
                      <span className="text-[11px] font-bold text-success">+{fmt(m.change, 2)}%</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[11px] font-bold text-danger mb-2">📉 Top Losers</div>
                  {top5Losers.map(m => (
                    <div key={m.symbol} className="flex items-center justify-between py-1.5 border-b border-border1 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <CoinLogo symbol={m.symbol} size={16} />
                        <span className="text-[11px] font-semibold text-text1">{m.symbol}</span>
                      </div>
                      <span className="text-[11px] font-bold text-danger">{fmt(m.change, 2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ─── RIGHT: News + Calendar ─── */}
      <div className="w-[320px] shrink-0 border-l border-border1 flex flex-col overflow-hidden">

        {/* News */}
        <div className="flex-1 flex flex-col overflow-hidden border-b border-border1" style={{ flex: '1 1 0' }}>
          <div className="px-3 py-2.5 border-b border-border1 bg-surface shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] font-bold text-text1">Global News</div>
              {newsLoading && <div className="w-3 h-3 border border-border2 border-t-accent rounded-full animate-spin" />}
            </div>
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
            {filteredNews.length === 0 && !newsLoading && (
              <div className="py-8 text-center text-[11px] text-text3">No news available</div>
            )}
            {filteredNews.map((n, i) => {
              const url = n.url || n.link || '#';
              const source = typeof n.source === 'object' ? n.source?.title : n.source;
              const img = n.image || n.urlToImage;
              return (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex gap-2.5 px-3 py-2.5 border-b border-border1 hover:bg-surface2/50 transition-colors group">
                  {img && (
                    <img src={img} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-surface2"
                      onError={e => (e.currentTarget.style.display = 'none')} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-text1 leading-snug mb-1 group-hover:text-accent transition-colors line-clamp-3">{n.title}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-text3">
                      <span>{source || 'News'}</span>
                      {n.currencies?.[0] && <span className="px-1 py-0.5 rounded bg-surface2 border border-border1 text-[9px]">{n.currencies[0].code}</span>}
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
