'use client';

import { useState, useEffect, useCallback } from 'react';
import { Market, Ticker, getOrderbook, getCandles, getRecentTrades, Orderbook, Candle, Trade } from '@/lib/pacifica';
import { CoinLogo } from '@/components/CoinLogo';
import { fmt, fmtPrice, getMarkPrice, get24hChange } from '@/lib/utils';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, LineChart, Line } from 'recharts';

interface OverviewProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
}

type SortKey = 'volume' | 'change' | 'price' | 'oi' | 'funding';
type SortDir = 'asc' | 'desc';
interface FearGreed { value: number; classification: string; }

const sparkCache: Record<string, { data: number[]; ts: number }> = {};
async function fetchSparkline(symbol: string): Promise<number[]> {
  const cached = sparkCache[symbol];
  if (cached && Date.now() - cached.ts < 120000) return cached.data;
  try {
    const end = Date.now();
    const start = end - 4 * 3600000 * 24;
    const res = await fetch(`/api/proxy?path=${encodeURIComponent('kline?symbol=' + symbol + '&interval=4h&start_time=' + start + '&end_time=' + end)}`);
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      const data = json.data.map((c: { c: string }) => Number(c.c));
      sparkCache[symbol] = { data, ts: Date.now() };
      return data;
    }
  } catch {}
  return [];
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length) return <div className="w-20 h-8" />;
  return (
    <div className="w-20 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="v" stroke={positive ? '#10b981' : '#ef4444'} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function HeatCell({ value, suffix = '%', decimals = 2 }: { value: number; suffix?: string; decimals?: number }) {
  if (value === 0) return <span className="text-[11px] text-text3 font-mono">0.00{suffix}</span>;
  const abs = Math.abs(value);
  const intensity = Math.min(abs / 8, 1);
  const bg = value > 0 ? `rgba(16,185,129,${0.06 + intensity * 0.14})` : `rgba(239,68,68,${0.06 + intensity * 0.14})`;
  const color = value > 0 ? '#059669' : '#dc2626';
  return (
    <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-semibold font-mono" style={{ background: bg, color }}>
      {value > 0 ? '+' : ''}{fmt(value, decimals)}{suffix}
    </span>
  );
}

function FearGreedGauge({ data }: { data: FearGreed | null }) {
  if (!data) return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 border-2 border-border2 border-t-accent rounded-full animate-spin" />
    </div>
  );
  const v = data.value;
  const color = v <= 25 ? '#dc2626' : v <= 45 ? '#f97316' : v <= 55 ? '#f59e0b' : v <= 75 ? '#84cc16' : '#10b981';
  const rotation = -90 + (v / 100) * 180;
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-12 h-7 overflow-hidden">
        <svg viewBox="0 0 60 34" className="w-full h-full">
          <path d="M5,30 A25,25 0 0,1 55,30" fill="none" stroke="#e2e8f0" strokeWidth="6" />
          <path d="M5,30 A25,25 0 0,1 55,30" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${(v / 100) * 78.5} 78.5`} />
          <g transform={`translate(30,30) rotate(${rotation})`}>
            <line x1="0" y1="0" x2="0" y2="-16" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="0" cy="0" r="2" fill="#374151" />
          </g>
        </svg>
      </div>
      <div>
        <div className="text-[20px] font-bold leading-none" style={{ color }}>{v}</div>
        <div className="text-[10px] text-text3 mt-0.5">{data.classification || (v <= 25 ? 'Extreme Fear' : v <= 45 ? 'Fear' : v <= 55 ? 'Neutral' : v <= 75 ? 'Greed' : 'Extreme Greed')}</div>
      </div>
    </div>
  );
}

export function Overview({ markets, tickers }: OverviewProps) {
  const [selected, setSelected] = useState<Market | null>(null);
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [chartInterval, setChartInterval] = useState('1h');
  const [detailTab, setDetailTab] = useState<'chart' | 'orderbook' | 'liquidations'>('chart');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [filterPos, setFilterPos] = useState(false);
  const [filterNeg, setFilterNeg] = useState(false);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [altcoinSeason, setAltcoinSeason] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      // Try multiple CORS proxies
      const urls = [
        'https://api.alternative.me/fng/?limit=1',
        'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://api.alternative.me/fng/?limit=1'),
        '/api/external?url=' + encodeURIComponent('https://api.alternative.me/fng/?limit=1'),
      ];
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const json = await res.json();
          if (json.data?.[0]) {
            setFearGreed({ value: Number(json.data[0].value), classification: json.data[0].value_classification });
            return;
          }
        } catch {}
      }
      // Last resort: use a static fallback from known value
    }
    load();
    const iv = window.setInterval(load, 600000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!Object.keys(tickers).length) return;
    const arr = Object.values(tickers);
    const btcChange = get24hChange(tickers['BTC']);
    const outperforming = arr.filter(t => get24hChange(t) > btcChange).length;
    setAltcoinSeason(Math.round((outperforming / arr.length) * 100));
  }, [tickers]);

  useEffect(() => {
    if (!markets.length) return;
    const load = async () => {
      const batch = markets.slice(0, 25);
      const res = await Promise.all(batch.map(m => fetchSparkline(m.symbol).then(d => [m.symbol, d] as [string, number[]])));
      setSparklines(prev => ({ ...prev, ...Object.fromEntries(res) }));
    };
    load();
    setTimeout(async () => {
      const rest = markets.slice(25);
      const res = await Promise.all(rest.map(m => fetchSparkline(m.symbol).then(d => [m.symbol, d] as [string, number[]])));
      setSparklines(prev => ({ ...prev, ...Object.fromEntries(res) }));
    }, 2500);
  }, [markets]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function load() {
      const [ob, cd, tr] = await Promise.all([
        getOrderbook(selected!.symbol),
        getCandles(selected!.symbol, chartInterval, 100),
        getRecentTrades(selected!.symbol),
      ]);
      if (!cancelled) { setOrderbook(ob); setCandles(cd); setTrades(tr); }
    }
    load();
    const iv = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [selected, chartInterval]);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }, [sortKey]);

  const toggleFav = useCallback((sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  }, []);

  const filtered = markets
    .filter(m => {
      if (!m.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      if (showFavOnly && !favorites.has(m.symbol)) return false;
      const chg = get24hChange(tickers[m.symbol]);
      if (filterPos && chg <= 0) return false;
      if (filterNeg && chg >= 0) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = tickers[a.symbol], tb = tickers[b.symbol];
      let diff = 0;
      if (sortKey === 'volume') diff = Number(tb?.volume_24h || 0) - Number(ta?.volume_24h || 0);
      else if (sortKey === 'change') diff = get24hChange(tb) - get24hChange(ta);
      else if (sortKey === 'oi') diff = Number(tb?.open_interest || 0) - Number(ta?.open_interest || 0);
      else if (sortKey === 'price') diff = getMarkPrice(tb) - getMarkPrice(ta);
      else if (sortKey === 'funding') diff = Number(tb?.funding || 0) - Number(ta?.funding || 0);
      return sortDir === 'desc' ? diff : -diff;
    });

  const topGainers = [...markets]
    .sort((a, b) => get24hChange(tickers[b.symbol]) - get24hChange(tickers[a.symbol]))
    .slice(0, 3);

  const topLosers = [...markets]
    .sort((a, b) => get24hChange(tickers[a.symbol]) - get24hChange(tickers[b.symbol]))
    .slice(0, 3);

  const liquidations = trades.filter(t => t.cause === 'market_liquidation' || t.cause === 'backstop_liquidation');
  const sortedCandles = [...candles].sort((a, b) => a.t - b.t);
  const chartData = sortedCandles.map(candle => {
    const d = new Date(candle.t);
    let time: string;
    if (chartInterval === '1d') time = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    else if (chartInterval === '4h' || chartInterval === '1h') time = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    else time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return { time, price: Number(candle.c) };
  });
  const selTicker = selected ? tickers[selected.symbol] : null;
  const selPrice = getMarkPrice(selTicker ?? undefined);
  const selChange = get24hChange(selTicker ?? undefined);
  const firstCandle = sortedCandles[0];
  const lastCandle = sortedCandles[sortedCandles.length - 1];
  const chartChange = firstCandle && lastCandle
    ? Number(lastCandle.c) - Number(firstCandle.o)
    : selChange;

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide cursor-pointer hover:text-text1 select-none whitespace-nowrap text-right first:text-left px-2" onClick={() => toggleSort(k)}>
      {label}{sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="flex flex-col h-full overflow-auto bg-bg">
      {/* Centered container */}
      <div className="w-full max-w-[1400px] mx-auto px-8">

        {/* TOP ROW: Fear&Greed + Altcoin Season + Trending + Top Gainers */}
        <div className="grid grid-cols-4 gap-4 py-5">

          {/* Fear & Greed */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
            <div className="text-[11px] font-semibold text-text2 mb-3">Fear & Greed Index</div>
            <FearGreedGauge data={fearGreed} />
          </div>

          {/* Altcoin Season */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
            <div className="text-[11px] font-semibold text-text2 mb-3">Altcoin Season</div>
            {altcoinSeason !== null ? (
              <>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-[20px] font-bold text-text1">{altcoinSeason}</span>
                  <span className="text-[11px] text-text3">/100</span>
                </div>
                <div className="relative h-2 bg-gradient-to-r from-orange-400 via-yellow-300 to-blue-500 rounded-full">
                  <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow border-2 border-slate-400 transition-all" style={{ left: `calc(${altcoinSeason}% - 6px)` }} />
                </div>
                <div className="flex justify-between text-[9px] text-text3 mt-1.5"><span>Bitcoin</span><span>Altcoin</span></div>
              </>
            ) : <div className="w-5 h-5 border-2 border-border2 border-t-accent rounded-full animate-spin" />}
          </div>

          {/* Top Losers */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-base">📉</span>
                <span className="text-[11px] font-semibold text-text2">Top Losers</span>
              </div>
            </div>
            <div className="space-y-2">
              {topLosers.map(m => {
                const change = get24hChange(tickers[m.symbol]);
                return (
                  <div key={m.symbol} className="flex items-center justify-between cursor-pointer hover:bg-surface2 rounded-lg px-1 py-0.5 transition-colors" onClick={() => setSelected(m)}>
                    <div className="flex items-center gap-2">
                      <CoinLogo symbol={m.symbol} size={20} />
                      <span className="text-[12px] font-semibold text-text1">{m.symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-semibold text-text1">${fmtPrice(getMarkPrice(tickers[m.symbol]))}</div>
                      <div className="text-[10px] font-semibold text-danger">{fmt(change, 2)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Gainers */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🚀</span>
                <span className="text-[11px] font-semibold text-text2">Top Gainers</span>
              </div>
            </div>
            <div className="space-y-2">
              {topGainers.map(m => {
                const change = get24hChange(tickers[m.symbol]);
                return (
                  <div key={m.symbol} className="flex items-center justify-between cursor-pointer hover:bg-surface2 rounded-lg px-1 py-0.5 transition-colors" onClick={() => setSelected(m)}>
                    <div className="flex items-center gap-2">
                      <CoinLogo symbol={m.symbol} size={20} />
                      <span className="text-[12px] font-semibold text-text1">{m.symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-semibold text-text1">${fmtPrice(getMarkPrice(tickers[m.symbol]))}</div>
                      <div className="text-[10px] font-semibold text-success">+{fmt(change, 2)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Market stats row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3 text-xs">⌕</span>
              <input className="bg-surface border border-border1 rounded-lg pl-7 pr-3 py-1.5 text-[11px] text-text1 placeholder-text3 outline-none focus:border-accent w-44" placeholder="Search symbol..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {[
              { label: '★ Favorites', active: showFavOnly, onClick: () => setShowFavOnly(v => !v), activeClass: 'bg-warn/10 border-warn/30 text-warn' },
              { label: '▲ Gainers', active: filterPos, onClick: () => { setFilterPos(v => !v); setFilterNeg(false); }, activeClass: 'bg-success/10 border-success/30 text-success' },
              { label: '▼ Losers', active: filterNeg, onClick: () => { setFilterNeg(v => !v); setFilterPos(false); }, activeClass: 'bg-danger/10 border-danger/30 text-danger' },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                className={'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ' + (btn.active ? btn.activeClass : 'bg-surface border-border1 text-text3 hover:text-text2')}>
                {btn.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-5">
            {[
              { label: 'Volume 24h', value: '$' + fmt(Object.values(tickers).reduce((s, t) => s + Number(t.volume_24h || 0), 0) / 1e9, 2) + 'B' },
              { label: 'Total OI', value: '$' + fmt(Object.values(tickers).reduce((s, t) => s + Number(t.open_interest || 0), 0) / 1e9, 2) + 'B' },
              { label: 'Markets', value: filtered.length + ' / ' + markets.length },
            ].map(s => (
              <div key={s.label} className="text-right">
                <div className="text-[9px] text-text3 uppercase tracking-wide font-semibold">{s.label}</div>
                <div className="text-[13px] font-bold text-text1">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* TABLE */}
        <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden mb-6">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border1 bg-surface2">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-2 py-2.5 text-[10px] font-semibold text-text3 uppercase text-left w-8">#</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase text-left">Symbol</th>
                <SortTh label="Price" k="price" />
                <SortTh label="24h %" k="change" />
                <SortTh label="Funding" k="funding" />
                <SortTh label="Volume 24h" k="volume" />
                <SortTh label="OI" k="oi" />
                <th className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase text-right">4h Chart</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => {
                const tk = tickers[m.symbol];
                const price = getMarkPrice(tk);
                const change = get24hChange(tk);
                const funding = Number(tk?.funding || 0) * 100;
                const volume = Number(tk?.volume_24h || 0);
                const oi = Number(tk?.open_interest || 0);
                const spark = sparklines[m.symbol] || [];
                const isActive = selected?.symbol === m.symbol;
                const isFav = favorites.has(m.symbol);
                const fmtLarge = (v: number) => v >= 1e9 ? '$' + fmt(v / 1e9, 2) + 'B' : v >= 1e6 ? '$' + fmt(v / 1e6, 2) + 'M' : '$' + fmt(v / 1e3, 1) + 'K';

                return (
                  <tr key={m.symbol} onClick={() => setSelected(isActive ? null : m)}
                    className={'border-b border-border1 cursor-pointer transition-colors ' + (isActive ? 'bg-accent/5' : 'hover:bg-slate-50/80')}>
                    <td className="px-3 py-2 text-center w-8">
                      <button onClick={e => toggleFav(m.symbol, e)} className={'text-[13px] leading-none transition-colors ' + (isFav ? 'text-amber-400' : 'text-slate-200 hover:text-amber-300')}>
                        {isFav ? '★' : '☆'}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-[11px] text-text3 font-mono w-8">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <CoinLogo symbol={m.symbol} size={22} />
                        <div>
                          <div className="text-[12px] font-semibold text-text1 leading-none">{m.symbol}</div>
                          <div className="text-[9px] text-text3 leading-none mt-0.5">{m.max_leverage}x max</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold text-text1 font-mono">${fmtPrice(price)}</td>
                    <td className="px-3 py-2 text-right"><HeatCell value={change} /></td>
                    <td className="px-3 py-2 text-right"><HeatCell value={funding} decimals={4} /></td>
                    <td className="px-3 py-2 text-right text-[11px] text-text2 font-mono">{fmtLarge(volume)}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-text2 font-mono">{fmtLarge(oi)}</td>
                    <td className="px-3 py-2"><div className="flex justify-end"><Sparkline data={spark} positive={change >= 0} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAIL PANEL - slides over as fixed right panel */}
      {selected && (
        <div className="fixed right-0 top-12 bottom-0 w-[520px] bg-surface border-l border-border1 shadow-card-md flex flex-col z-40 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border1 bg-surface shrink-0">
            <CoinLogo symbol={selected.symbol} size={32} />
            <div>
              <div className="font-bold text-[15px] text-text1 leading-none">{selected.symbol}-PERP</div>
              <div className="text-[10px] text-text3 mt-0.5">Max {selected.max_leverage}x · Pacifica</div>
            </div>
            <div className="ml-3">
              <div className={'font-bold text-[18px] leading-none ' + (selChange >= 0 ? 'text-success' : 'text-danger')}>${fmtPrice(selPrice)}</div>
              <div className="mt-0.5"><HeatCell value={selChange} /></div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {[
                { label: 'Volume', value: '$' + fmt(Number(selTicker?.volume_24h || 0) / 1e6, 2) + 'M' },
                { label: 'Funding', value: (Number(selTicker?.funding || 0) >= 0 ? '+' : '') + fmt(Number(selTicker?.funding || 0) * 100, 4) + '%', color: Number(selTicker?.funding || 0) >= 0 ? 'text-success' : 'text-danger' },
              ].map(s => (
                <div key={s.label} className="text-right">
                  <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide">{s.label}</div>
                  <div className={'text-[12px] font-semibold ' + (s.color || 'text-text1')}>{s.value}</div>
                </div>
              ))}
              <button onClick={() => setSelected(null)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface2 text-text3 hover:text-text1 transition-colors">✕</button>
            </div>
          </div>

          <div className="flex border-b border-border1 bg-surface shrink-0">
            {(['chart', 'orderbook', 'trades'] as const).map(t => (
              <button key={t} onClick={() => setDetailTab(t as 'chart' | 'orderbook' | 'liquidations')}
                className={'px-4 py-2 text-[11px] font-semibold uppercase tracking-wide border-b-2 transition-all ' + (detailTab === t ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}>
                {t === 'trades' ? 'Recent Trades' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {detailTab === 'chart' && (
              <div className="flex flex-col h-full">
                <div className="flex gap-1 px-4 py-2 bg-surface border-b border-border1 shrink-0">
                  {['1m', '5m', '15m', '1h', '4h', '1d'].map(iv => (
                    <button key={iv} onClick={() => setChartInterval(iv)}
                      className={'px-2.5 py-1 rounded text-[11px] font-semibold transition-all ' + (chartInterval === iv ? 'bg-accent text-white' : 'text-text2 hover:bg-surface2')}>{iv}</button>
                  ))}
                </div>
                {chartData.length > 0 ? (
                  <div className="flex-1 p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
                        <defs>
                          <linearGradient id={`grad-${selected?.symbol}-${chartInterval}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={chartChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.15} />
                            <stop offset="95%" stopColor={chartChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={v => '$' + fmtPrice(v)} width={75} />
                        <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border1)', borderRadius: 8, fontSize: 11, color: 'var(--color-text1)' }} formatter={(v: number) => ['$' + fmtPrice(v), 'Price']} />
                        <Area type="monotone" dataKey="price" stroke={chartChange >= 0 ? '#10b981' : '#ef4444'} strokeWidth={2} fill={`url(#grad-${selected?.symbol}-${chartInterval})`} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="flex-1 flex items-center justify-center text-text3 text-sm">Loading chart...</div>}
              </div>
            )}

            {detailTab === 'orderbook' && (
              <div className="flex h-full">
                {[{ label: 'Bids', levels: orderbook?.bids ?? [], isAsk: false }, { label: 'Asks', levels: orderbook?.asks ?? [], isAsk: true }].map(side => (
                  <div key={side.label} className={'flex-1 flex flex-col overflow-hidden ' + (!side.isAsk ? 'border-r border-border1' : '')}>
                    <div className="px-3 py-2 border-b border-border1 bg-surface2 shrink-0">
                      <span className={'text-[11px] font-bold uppercase tracking-wide ' + (side.isAsk ? 'text-danger' : 'text-success')}>{side.label}</span>
                    </div>
                    <div className="grid px-3 py-1.5 border-b border-border1 bg-surface2 text-[10px] text-text3 font-semibold uppercase shrink-0" style={{ gridTemplateColumns: '1fr 1fr 40px' }}>
                      <span>Price</span><span className="text-right">Size</span><span className="text-right">N</span>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {side.levels.map((l, i) => {
                        const max = Math.max(...side.levels.map(x => Number(x.a)));
                        const pct = max > 0 ? (Number(l.a) / max) * 100 : 0;
                        return (
                          <div key={i} className="relative grid px-3 py-1.5 hover:bg-surface2" style={{ gridTemplateColumns: '1fr 1fr 40px' }}>
                            <div className={'absolute inset-y-0 left-0 ' + (side.isAsk ? 'bg-danger/8' : 'bg-success/8')} style={{ width: pct + '%' }} />
                            <span className={'text-[11px] font-mono font-semibold relative ' + (side.isAsk ? 'text-danger' : 'text-success')}>${fmtPrice(l.p)}</span>
                            <span className="text-[11px] font-mono text-text1 text-right relative">{fmt(Number(l.a), 4)}</span>
                            <span className="text-[11px] font-mono text-text3 text-right relative">{l.n}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {detailTab === 'liquidations' && (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  {liquidations.length > 0 ? (
                    <table className="w-full">
                      <thead className="sticky top-0 bg-surface2 border-b border-border1">
                        <tr>{['Time', 'Side', 'Price', 'Size', 'Type'].map(h => <th key={h} className="px-3 py-1.5 text-[10px] text-text3 font-semibold uppercase text-left">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {liquidations.map((t, i) => {
                          const isLong = t.side.includes('long');
                          return (
                            <tr key={i} className="border-b border-border1 hover:bg-surface2">
                              <td className="px-3 py-1.5 text-[11px] text-text3 font-mono">{new Date(t.created_at).toLocaleTimeString()}</td>
                              <td className={'px-3 py-1.5 text-[11px] font-bold ' + (isLong ? 'text-danger' : 'text-success')}>{isLong ? 'LONG LIQ' : 'SHORT LIQ'}</td>
                              <td className="px-3 py-1.5 text-[11px] font-mono">${fmtPrice(t.price)}</td>
                              <td className="px-3 py-1.5 text-[11px] font-mono">{fmt(Number(t.amount), 4)}</td>
                              <td className="px-3 py-1.5 text-[10px] text-text3">{t.cause === 'backstop_liquidation' ? 'Backstop' : 'Market'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-text3 gap-2">
                      <span className="text-xl">✓</span><p className="text-sm">No liquidations</p>
                    </div>
                  )}
                </div>
                <div className="border-t border-border1 max-h-48 overflow-y-auto shrink-0">
                  <div className="px-4 py-1.5 bg-surface2 border-b border-border1 sticky top-0">
                    <span className="text-[10px] text-text3 font-semibold uppercase">Recent Trades</span>
                  </div>
                  {trades.slice(0, 30).map((t, i) => {
                    const isLong = t.side.includes('long');
                    return (
                      <div key={i} className="grid px-3 py-1.5 border-b border-border1 hover:bg-surface2" style={{ gridTemplateColumns: '80px 1fr 1fr 1fr' }}>
                        <span className="text-[10px] text-text3 font-mono">{new Date(t.created_at).toLocaleTimeString()}</span>
                        <span className={'text-[11px] font-semibold ' + (isLong ? 'text-success' : 'text-danger')}>{t.side.replace('_', ' ').toUpperCase()}</span>
                        <span className="text-[11px] font-mono text-text1">${fmtPrice(t.price)}</span>
                        <span className="text-[11px] font-mono text-text2 text-right">{fmt(Number(t.amount), 4)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
