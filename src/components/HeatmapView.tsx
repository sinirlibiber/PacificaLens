'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Market } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
const LiquidationHeatmapModal = dynamic(() => import('./LiquidationHeatmapModal'), { ssr: false });

interface LiqSymbolData { symbol: string; longLiq: number; shortLiq: number; total: number; count: number; }
interface LiqEvent { id: string; symbol: string; side: 'long'|'short'; price: number; notional: number; ts: number; }
interface ApiMeta { fetchedAt: number; totalEvents: number; }

const HOURS_OPTIONS = [
  { label: '1h', value: 1 }, { label: '6h', value: 6 },
  { label: '24h', value: 24 }, { label: '7d', value: 168 },
];

const fmtV = (v: number) =>
  v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` :
  v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

const fmtAgo = (ts: number) => {
  const d = Date.now() - ts;
  if (d < 60000) return `${Math.floor(d/1000)}s ago`;
  if (d < 3600000) return `${Math.floor(d/60000)}m ago`;
  return `${Math.floor(d/3600000)}h ago`;
};

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12: false });

export default function HeatmapView({ markets }: { markets: Market[] }) {
  const [summary,     setSummary    ] = useState<LiqSymbolData[]>([]);
  const [recent,      setRecent     ] = useState<LiqEvent[]>([]);
  const [meta,        setMeta       ] = useState<ApiMeta | null>(null);
  const [loading,     setLoading    ] = useState(false);
  const [hours,       setHours      ] = useState(24);
  const [search,      setSearch     ] = useState('');
  const [tab,         setTab        ] = useState<'grid'|'list'|'feed'>('grid');
  const [sortBy,      setSortBy     ] = useState<'total'|'long'|'short'>('total');
  const [modalSymbol, setModalSymbol] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const EXTRA_HL = ['SP500','XAU','CL','TSLA','USDJPY','EURUSD','GOOGL','NVDA','PLTR','PLATINUM','URNM','COPPER','SILVER','NATGAS','CRCL','HOOD'];
      const fromMarkets = markets.map(m => m.symbol.replace(/-USD$/i,'').toUpperCase());
      const allSymbols = Array.from(new Set([...fromMarkets, ...EXTRA_HL]));
      const res = await fetch(`/api/liq-multi?hours=${hours}&symbols=${encodeURIComponent(allSymbols.join(','))}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error('fail');
      const data = await res.json();
      if (!ctrl.signal.aborted) {
        setSummary(data.summary ?? []);
        setRecent(data.recent ?? []);
        setMeta(data.meta ?? null);
      }
    } catch { /* aborted */ }
    finally { if (!ctrl.signal.aborted) setLoading(false); }
  }, [hours, markets]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const filtered = summary
    .filter(s => !search || s.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sortBy === 'long' ? b.longLiq - a.longLiq :
      sortBy === 'short' ? b.shortLiq - a.shortLiq :
      b.total - a.total
    );

  const maxTotal   = filtered[0]?.total || 1;
  const grandTotal = filtered.reduce((s, x) => s + x.total, 0);
  const grandLong  = filtered.reduce((s, x) => s + x.longLiq, 0);
  const grandShort = filtered.reduce((s, x) => s + x.shortLiq, 0);
  const longPct    = grandTotal > 0 ? (grandLong / grandTotal) * 100 : 50;

  const getPacMarket = (sym: string) =>
    markets.find(m => m.symbol.replace(/-USD$/i,'').toUpperCase() === sym);

  const openModal = (sym: string) => {
    const pm = getPacMarket(sym);
    setModalSymbol(pm?.symbol ?? (sym + '-USD'));
  };

  return (
    <div className="flex flex-col h-full gap-0">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border1 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-[14px] font-bold text-text1 leading-none">Liquidation Monitor</h2>
            <p className="text-[10px] text-text3 mt-0.5">2 Perp DEX data</p>
          </div>
          {/* Live dot */}
          <div className="flex items-center gap-1.5 text-[10px] text-text3">
            {loading
              ? <span className="animate-spin text-accent text-[12px]">↻</span>
              : <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block"/>}
            {meta && !loading && <span>{meta.totalEvents.toLocaleString()} events · {fmtAgo(meta.fetchedAt)}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Time filter */}
          <div className="flex items-center gap-0.5 bg-surface2 rounded-lg p-0.5 border border-border1">
            {HOURS_OPTIONS.map(o => (
              <button key={o.value} onClick={() => setHours(o.value)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                  hours === o.value ? 'bg-accent/15 text-accent' : 'text-text3 hover:text-text2'}`}>
                {o.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3 text-[11px]">⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="bg-surface2 border border-border1 rounded-lg pl-7 pr-3 py-1 text-[11px] text-text1 outline-none focus:border-accent placeholder-text3 w-24" />
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-0.5 bg-surface2 rounded-lg p-0.5 border border-border1">
            {([['grid','⊞'],['list','☰'],['feed','⚡']] as const).map(([t, icon]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2 py-1 rounded-md text-[11px] transition-all ${tab === t ? 'bg-surface text-text1 shadow-sm' : 'text-text3 hover:text-text2'}`}
                title={t}>
                {icon}
              </button>
            ))}
          </div>

          <button onClick={load} disabled={loading}
            className="p-1.5 bg-surface2 border border-border1 rounded-lg text-text2 hover:text-text1 transition-colors disabled:opacity-40">
            <span className={`text-[12px] ${loading ? 'animate-spin inline-block' : ''}`}>↻</span>
          </button>
        </div>
      </div>

      {/* ── Stats strip ── */}
      {grandTotal > 0 && (
        <div className="flex items-center gap-4 px-5 py-2 border-b border-border1 bg-surface2/30 shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide">Total Liq</div>
              <div className="text-[14px] font-bold text-text1">{fmtV(grandTotal)}</div>
            </div>
            <div className="w-px h-8 bg-border1"/>
            <div>
              <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide">Long</div>
              <div className="text-[14px] font-bold text-success">{fmtV(grandLong)}</div>
            </div>
            <div className="w-px h-8 bg-border1"/>
            <div>
              <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide">Short</div>
              <div className="text-[14px] font-bold text-danger">{fmtV(grandShort)}</div>
            </div>
            <div className="w-px h-8 bg-border1"/>
            {/* Long/short bar */}
            <div className="flex flex-col gap-0.5 w-32">
              <div className="flex h-2 rounded-full overflow-hidden">
                <div className="bg-success transition-all" style={{ width: `${longPct}%` }}/>
                <div className="bg-danger flex-1"/>
              </div>
              <div className="flex justify-between text-[9px] text-text3">
                <span>Long {longPct.toFixed(0)}%</span>
                <span>Short {(100-longPct).toFixed(0)}%</span>
              </div>
            </div>
          </div>
          <div className="ml-auto text-[10px] text-text3">
            <span className="opacity-60">Click row for heatmap</span>
          </div>

        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">

        {loading && filtered.length === 0 && (
          <div className="flex items-center justify-center py-20 gap-2 text-text3 text-[12px]">
            <span className="animate-spin text-accent">↻</span> Fetching data...
          </div>
        )}
        {!loading && filtered.length === 0 && tab !== 'feed' && (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="text-3xl">⚡</span>
            <span className="text-text2 text-[13px] font-semibold">No liquidation data</span>
            <span className="text-text3 text-[11px]">Try a wider time range</span>
          </div>
        )}

        {/* GRID VIEW */}
        {tab === 'grid' && filtered.length > 0 && (
          <div className="p-4 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {filtered.map((s) => {
              const lp = s.total > 0 ? (s.longLiq / s.total) * 100 : 50;
              const sp = 100 - lp;
              const intensity = Math.pow(s.total / maxTotal, 0.4);
              const pm = getPacMarket(s.symbol);
              return (
                <div key={s.symbol}
                  onClick={() => openModal(s.symbol)}
                  className="group relative bg-surface border border-border1 rounded-xl p-3 cursor-pointer hover:border-accent/40 hover:bg-surface2/60 transition-all"
                  style={{ boxShadow: `0 0 0 0 transparent` }}>

                  {/* Intensity indicator */}
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl overflow-hidden">
                    <div className="h-full transition-all"
                      style={{
                        width: `${intensity * 100}%`,
                        background: lp >= 50
                          ? `rgba(52,211,153,${0.4 + intensity * 0.6})`
                          : `rgba(239,68,68,${0.4 + intensity * 0.6})`,
                      }}/>
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <CoinLogo symbol={pm?.symbol ?? (s.symbol+'-USD')} size={20}/>
                      <span className="text-[12px] font-bold text-text1">{s.symbol}</span>
                    </div>
                    <span className="text-[9px] text-text3 opacity-0 group-hover:opacity-100 transition-opacity">↗ map</span>
                  </div>

                  <div className="text-[15px] font-bold text-text1 mb-1">{fmtV(s.total)}</div>

                  {/* Long/short bar */}
                  <div className="flex h-1.5 rounded-full overflow-hidden mb-1.5">
                    <div className="bg-success/80" style={{ width: `${lp}%` }}/>
                    <div className="bg-danger/80 flex-1"/>
                  </div>

                  <div className="flex justify-between text-[10px]">
                    <span className="text-success font-semibold">{fmtV(s.longLiq)}</span>
                    <span className="text-danger font-semibold">{fmtV(s.shortLiq)}</span>
                  </div>
                  <div className="flex justify-between text-[9px] text-text3 mt-0.5">
                    <span>Long {lp.toFixed(0)}%</span>
                    <span>Short {sp.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* LIST VIEW */}
        {tab === 'list' && filtered.length > 0 && (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface2 border-b border-border1 z-10">
              <tr>
                <th className="text-left pl-4 py-2 text-[10px] text-text3 font-semibold uppercase w-8">#</th>
                <th className="text-left pl-2 py-2 text-[10px] text-text3 font-semibold uppercase">Symbol</th>
                <th className="text-right pr-4 py-2 text-[10px] text-text3 font-semibold uppercase">Total</th>
                <th className="text-right pr-4 py-2 text-[10px] text-success font-semibold uppercase">Long</th>
                <th className="text-right pr-4 py-2 text-[10px] text-danger font-semibold uppercase">Short</th>
                <th className="text-right pr-4 py-2 text-[10px] text-text3 font-semibold uppercase w-40">L/S Ratio</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => {
                const lp = s.total > 0 ? (s.longLiq / s.total) * 100 : 50;
                const pm = getPacMarket(s.symbol);
                return (
                  <tr key={s.symbol}
                    onClick={() => openModal(s.symbol)}
                    className="border-b border-border1/30 hover:bg-surface2/50 cursor-pointer transition-colors">
                    <td className="pl-4 py-2.5 text-text3 font-mono">{idx+1}</td>
                    <td className="pl-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <CoinLogo symbol={pm?.symbol ?? (s.symbol+'-USD')} size={20}/>
                        <div>
                          <div className="font-bold text-text1">{s.symbol}</div>
                          <div className={`text-[9px] font-semibold ${lp >= 50 ? 'text-success' : 'text-danger'}`}>
                            {lp >= 50 ? '▲ Longs' : '▼ Shorts'} dom.
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="pr-4 py-2.5 text-right">
                      <span className="font-bold text-text1">{fmtV(s.total)}</span>
                    </td>
                    <td className="pr-4 py-2.5 text-right text-success font-semibold">{fmtV(s.longLiq)}</td>
                    <td className="pr-4 py-2.5 text-right text-danger font-semibold">{fmtV(s.shortLiq)}</td>
                    <td className="pr-4 py-2.5 w-40">
                      <div className="flex h-1.5 rounded-full overflow-hidden">
                        <div className="bg-success/70" style={{ width: `${lp}%` }}/>
                        <div className="bg-danger/70 flex-1"/>
                      </div>
                      <div className="flex justify-between text-[9px] text-text3 mt-0.5">
                        <span>{lp.toFixed(0)}%</span>
                        <span>{(100-lp).toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* FEED VIEW */}
        {tab === 'feed' && (
          <div>
            {recent.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <span className="text-3xl">📭</span>
                <span className="text-text2 text-[13px] font-semibold">No recent liquidations</span>
              </div>
            )}
            {recent
              .filter(e => !search || e.symbol.toLowerCase().includes(search.toLowerCase()))
              .slice(0, 200)
              .map((e, i) => {
                const pm = getPacMarket(e.symbol);
                return (
                  <div key={e.id ?? i}
                    onClick={() => openModal(e.symbol)}
                    className="flex items-center gap-3 px-5 py-2.5 border-b border-border1/30 hover:bg-surface2/50 cursor-pointer transition-colors">
                    <span className="font-mono text-[10px] text-text3 w-12 shrink-0">{fmtTime(e.ts)}</span>
                    <div className="flex items-center gap-1.5 w-24 shrink-0">
                      <CoinLogo symbol={pm?.symbol ?? (e.symbol+'-USD')} size={16}/>
                      <span className="text-[12px] font-bold text-text1">{e.symbol}</span>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      e.side === 'long' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {e.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </span>
                    <span className="text-[12px] font-mono font-bold text-text1 ml-auto">{fmtV(e.notional)}</span>
                    <span className="font-mono text-[10px] text-text3 w-24 text-right shrink-0">
                      {e.price > 0 ? `$${e.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {modalSymbol && (
        <LiquidationHeatmapModal symbol={modalSymbol} onClose={() => setModalSymbol(null)} />
      )}
    </div>
  );
}
