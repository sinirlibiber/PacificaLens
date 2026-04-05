'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  const [summary, setSummary] = useState<LiqSymbolData[]>([]);
  const [recent,  setRecent ] = useState<LiqEvent[]>([]);
  const [meta,    setMeta   ] = useState<ApiMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [hours,   setHours  ] = useState(24);
  const [search,  setSearch ] = useState('');
  const [tab,     setTab    ] = useState<'grid'|'list'|'feed'>('grid');
  const [sortBy,  setSortBy ] = useState<'total'|'long'|'short'>('total');
  const [modalSymbol, setModalSymbol] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const EXTRA_HL = ['SP500','XAU','CL','TSLA','USDJPY','EURUSD','GOOGL','NVDA','PLTR','PLATINUM','URNM','COPPER','SILVER','NATGAS','CRCL','HOOD'];
      const fromMarkets = markets.map((m: Market) => m.symbol.replace(/-USD$/i,'').toUpperCase());
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
    .filter((s: LiqSymbolData) => !search || s.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a: LiqSymbolData, b: LiqSymbolData) =>
      sortBy === 'long' ? b.longLiq - a.longLiq :
      sortBy === 'short' ? b.shortLiq - a.shortLiq :
      b.total - a.total
    );

  const maxTotal   = filtered[0]?.total || 1;
  const grandTotal = filtered.reduce((s: number, x: LiqSymbolData) => s + x.total, 0);
  const grandLong  = filtered.reduce((s: number, x: LiqSymbolData) => s + x.longLiq, 0);
  const grandShort = filtered.reduce((s: number, x: LiqSymbolData) => s + x.shortLiq, 0);
  const longPct    = grandTotal > 0 ? (grandLong / grandTotal) * 100 : 50;

  const getPacMarket = (sym: string) =>
    markets.find((m: Market) => m.symbol.replace(/-USD$/i,'').toUpperCase() === sym);
  const openModal = (sym: string) => {
    const pm = getPacMarket(sym);
    setModalSymbol(pm?.symbol ?? (sym + '-USD'));
  };

  return (
    <div className="bg-surface border border-border1 rounded-xl overflow-hidden">

      {/* Header */}
      <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-accent" />
          <span className="text-[12px] font-bold text-text1">Liquidation Monitor</span>
          <span className="text-[10px] text-text3">2 Perp DEX data</span>
          <div className="flex items-center gap-1.5 text-[10px] text-text3">
            {loading
              ? <span className="animate-spin text-accent text-[11px]">↻</span>
              : <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block"/>}
            {meta && !loading && <span>{meta.totalEvents.toLocaleString()} events · {fmtAgo(meta.fetchedAt)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Time */}
          <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5 border border-border1">
            {HOURS_OPTIONS.map(o => (
              <button key={o.value} onClick={() => setHours(o.value)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${hours === o.value ? 'bg-accent/15 text-accent' : 'text-text3 hover:text-text2'}`}>
                {o.label}
              </button>
            ))}
          </div>
          {/* Search */}
          <input value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder="Filter..."
            className="bg-surface border border-border1 rounded-lg px-2.5 py-1 text-[10px] text-text1 outline-none focus:border-accent placeholder-text3 w-20" />
          {/* View */}
          <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5 border border-border1">
            {([['grid','⊞'],['list','☰'],['feed','⚡']] as const).map(([t, icon]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2 py-1 rounded-md text-[11px] transition-all ${tab === t ? 'bg-surface2 text-text1 shadow-sm' : 'text-text3 hover:text-text2'}`}>
                {icon}
              </button>
            ))}
          </div>
          {/* Sort */}
          {tab !== 'feed' && (
            <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5 border border-border1">
              {(['total','long','short'] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all capitalize ${sortBy === s ? 'bg-accent/15 text-accent' : 'text-text3 hover:text-text2'}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <button onClick={load} disabled={loading}
            className="p-1.5 bg-surface border border-border1 rounded-lg text-text2 hover:text-text1 disabled:opacity-40">
            <span className={`text-[11px] ${loading ? 'animate-spin inline-block' : ''}`}>↻</span>
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {grandTotal > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border1 bg-surface2/30">
          <div className="flex items-center gap-3 text-[11px]">
            <div><span className="text-text3 text-[9px] uppercase font-semibold mr-1.5">Total Liq</span><span className="font-bold text-text1">{fmtV(grandTotal)}</span></div>
            <div><span className="text-text3 text-[9px] uppercase font-semibold mr-1.5">Long</span><span className="font-bold text-success">{fmtV(grandLong)}</span></div>
            <div><span className="text-text3 text-[9px] uppercase font-semibold mr-1.5">Short</span><span className="font-bold text-danger">{fmtV(grandShort)}</span></div>
          </div>
          <div className="flex flex-col gap-0.5 w-28">
            <div className="flex h-1.5 rounded-full overflow-hidden">
              <div className="bg-success transition-all" style={{ width: `${longPct}%` }}/>
              <div className="bg-danger flex-1"/>
            </div>
            <div className="flex justify-between text-[8px] text-text3">
              <span>Long {longPct.toFixed(0)}%</span><span>Short {(100-longPct).toFixed(0)}%</span>
            </div>
          </div>
          <span className="ml-auto text-[9px] text-text3 opacity-60">click for heatmap</span>
        </div>
      )}

      {/* GRID */}
      {tab === 'grid' && (
        <div className="p-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))' }}>
          {loading && filtered.length === 0 && (
            <div className="col-span-full flex items-center justify-center py-12 text-text3 text-[11px] gap-2">
              <span className="animate-spin text-accent">↻</span> Fetching...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-text3 text-[11px]">No data — try a wider time range</div>
          )}
          {filtered.map((s: LiqSymbolData) => {
            const lp = s.total > 0 ? (s.longLiq / s.total) * 100 : 50;
            const intensity = Math.pow(s.total / maxTotal, 0.4);
            const pm = getPacMarket(s.symbol);
            return (
              <div key={s.symbol} onClick={() => openModal(s.symbol)}
                className="group relative bg-surface border border-border1 rounded-xl p-3 cursor-pointer hover:border-accent/40 hover:bg-surface2/60 transition-all">
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl overflow-hidden">
                  <div className="h-full transition-all" style={{
                    width: `${intensity * 100}%`,
                    background: lp >= 50 ? `rgba(52,211,153,${0.4+intensity*0.6})` : `rgba(239,68,68,${0.4+intensity*0.6})`,
                  }}/>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <CoinLogo symbol={pm?.symbol ?? (s.symbol+'-USD')} size={18}/>
                    <span className="text-[12px] font-bold text-text1">{s.symbol}</span>
                  </div>
                  <span className="text-[8px] text-text3 opacity-0 group-hover:opacity-100 transition-opacity">↗ map</span>
                </div>
                <div className="text-[15px] font-bold text-text1 mb-1.5">{fmtV(s.total)}</div>
                <div className="flex h-1.5 rounded-full overflow-hidden mb-1.5">
                  <div className="bg-success/80" style={{ width: `${lp}%` }}/><div className="bg-danger/80 flex-1"/>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-success font-semibold">{fmtV(s.longLiq)}</span>
                  <span className="text-danger font-semibold">{fmtV(s.shortLiq)}</span>
                </div>
                <div className="flex justify-between text-[8px] text-text3 mt-0.5">
                  <span>Long {lp.toFixed(0)}%</span><span>Short {(100-lp).toFixed(0)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LIST */}
      {tab === 'list' && (
        <div>
          <div className="grid px-4 py-2 bg-surface2/50 border-b border-border1 text-[9px] uppercase tracking-wide text-text3 font-semibold"
            style={{ gridTemplateColumns: '28px 1fr 90px 80px 80px 110px' }}>
            <span>#</span><span>Symbol</span><span className="text-right">Total</span>
            <span className="text-right">Long</span><span className="text-right">Short</span><span className="text-center">L/S</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
            {filtered.length === 0 && (
              <div className="py-12 text-center text-text3 text-[11px]">
                {loading ? 'Fetching...' : 'No data — try a wider time range'}
              </div>
            )}
            {filtered.map((s: LiqSymbolData, idx: number) => {
              const lp = s.total > 0 ? (s.longLiq / s.total) * 100 : 50;
              const pm = getPacMarket(s.symbol);
              return (
                <div key={s.symbol} onClick={() => openModal(s.symbol)}
                  className="grid items-center px-4 py-2.5 border-b border-border1/40 hover:bg-surface2/60 cursor-pointer transition-colors"
                  style={{ gridTemplateColumns: '28px 1fr 90px 80px 80px 110px' }}>
                  <span className="text-[10px] text-text3 font-mono">{idx+1}</span>
                  <div className="flex items-center gap-2">
                    <CoinLogo symbol={pm?.symbol ?? (s.symbol+'-USD')} size={18}/>
                    <div>
                      <div className="text-[12px] font-bold text-text1">{s.symbol}</div>
                      <div className={`text-[9px] font-semibold ${lp >= 50 ? 'text-success' : 'text-danger'}`}>
                        {lp >= 50 ? '▲ Longs dom.' : '▼ Shorts dom.'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right"><span className="text-[12px] font-bold text-text1">{fmtV(s.total)}</span></div>
                  <div className="text-right"><span className="text-[11px] font-semibold text-success">{fmtV(s.longLiq)}</span></div>
                  <div className="text-right"><span className="text-[11px] font-semibold text-danger">{fmtV(s.shortLiq)}</span></div>
                  <div className="mx-2">
                    <div className="flex h-1.5 rounded-full overflow-hidden">
                      <div className="bg-success/70" style={{ width: `${lp}%` }}/><div className="bg-danger/70 flex-1"/>
                    </div>
                    <div className="flex justify-between text-[8px] text-text3 mt-0.5">
                      <span>{lp.toFixed(0)}%</span><span>{(100-lp).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FEED */}
      {tab === 'feed' && (
        <div>
          <div className="grid px-4 py-2 bg-surface2/50 border-b border-border1 text-[9px] uppercase tracking-wide text-text3 font-semibold"
            style={{ gridTemplateColumns: '52px 1fr 60px 80px 80px' }}>
            <span>Time</span><span>Symbol</span><span>Side</span>
            <span className="text-right">Size</span><span className="text-right">Price</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
            {recent.length === 0 && !loading && (
              <div className="py-12 text-center text-text3 text-[11px]">No recent liquidations</div>
            )}
            {recent
              .filter((e: LiqEvent) => !search || e.symbol.toLowerCase().includes(search.toLowerCase()))
              .slice(0, 200)
              .map((e: LiqEvent, i: number) => {
                const pm = getPacMarket(e.symbol);
                return (
                  <div key={e.id ?? i} onClick={() => openModal(e.symbol)}
                    className="grid items-center px-4 py-2 border-b border-border1/30 hover:bg-surface2/50 cursor-pointer transition-colors"
                    style={{ gridTemplateColumns: '52px 1fr 60px 80px 80px' }}>
                    <span className="font-mono text-[9px] text-text3">{fmtTime(e.ts)}</span>
                    <div className="flex items-center gap-1.5">
                      <CoinLogo symbol={pm?.symbol ?? (e.symbol+'-USD')} size={15}/>
                      <span className="text-[11px] font-bold text-text1">{e.symbol}</span>
                    </div>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${e.side === 'long' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {e.side === 'long' ? '▲ L' : '▼ S'}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-text1 text-right">{fmtV(e.notional)}</span>
                    <span className="font-mono text-[9px] text-text3 text-right">
                      {e.price > 0 ? `$${e.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {modalSymbol && typeof document !== 'undefined' && createPortal(
        <LiquidationHeatmapModal symbol={modalSymbol} onClose={() => setModalSymbol(null)} />,
        document.body
      )}
    </div>
  );
}
