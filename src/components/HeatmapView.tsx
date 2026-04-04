'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Market } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
const LiquidationHeatmapModal = dynamic(() => import('./LiquidationHeatmapModal'), { ssr: false });

interface LiqSymbolData {
  symbol: string;
  longLiq: number;
  shortLiq: number;
  total: number;
  count: number;
  byExchange: { hyperliquid: number; binance: number; bybit: number };
}
interface LiqEvent {
  id: string;
  exchange: 'hyperliquid' | 'binance' | 'bybit';
  symbol: string;
  side: 'long' | 'short';
  price: number;
  notional: number;
  ts: number;
}
interface ApiMeta {
  fetchedAt: number;
  totalEvents: number;
  sources: { binance: number; hyperliquid: number; bybit: number };
}

const HOURS_OPTIONS = [
  { label: '1h',  value: 1   },
  { label: '6h',  value: 6   },
  { label: '24h', value: 24  },
  { label: '7d',  value: 168 },
];

function fmtV(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

export default function HeatmapView({ markets }: { markets: Market[] }) {
  const [summary,     setSummary    ] = useState<LiqSymbolData[]>([]);
  const [recent,      setRecent     ] = useState<LiqEvent[]>([]);
  const [meta,        setMeta       ] = useState<ApiMeta | null>(null);
  const [loading,     setLoading    ] = useState(false);
  const [hours,       setHours      ] = useState(24);
  const [search,      setSearch     ] = useState('');
  const [tab,         setTab        ] = useState<'table' | 'feed'>('table');
  const [sortBy,      setSortBy     ] = useState<'total' | 'long' | 'short' | 'count'>('total');
  const [modalSymbol, setModalSymbol] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res  = await fetch(`/api/liq-multi?hours=${hours}&exchange=all`, { signal: ctrl.signal });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      if (!ctrl.signal.aborted) {
        setSummary(data.summary  ?? []);
        setRecent(data.recent    ?? []);
        setMeta(data.meta        ?? null);
      }
    } catch { /* aborted */ }
    finally  { if (!ctrl.signal.aborted) setLoading(false); }
  }, [hours]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const filtered = summary
    .filter(s => !search || s.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'long')  return b.longLiq  - a.longLiq;
      if (sortBy === 'short') return b.shortLiq - a.shortLiq;
      if (sortBy === 'count') return b.count    - a.count;
      return b.total - a.total;
    });

  const maxTotal = filtered[0]?.total || 1;

  // totals
  const grandTotal     = filtered.reduce((s, x) => s + x.total, 0);
  const grandLong      = filtered.reduce((s, x) => s + x.longLiq, 0);
  const grandShort     = filtered.reduce((s, x) => s + x.shortLiq, 0);

  const SortBtn = ({ col, label }: { col: typeof sortBy; label: string }) => (
    <button onClick={() => setSortBy(col)}
      className={`flex items-center gap-0.5 transition-colors text-[11px] font-semibold ${sortBy === col ? 'text-accent' : 'text-text3 hover:text-text2'}`}>
      {label}{sortBy === col && <span className="text-[9px] ml-0.5">▼</span>}
    </button>
  );

  const SOURCE_COLORS: Record<string, string> = { binance: '#F0B90B', hyperliquid: '#00E5CF', bybit: '#F7A600' };
  const SOURCE_SHORT:  Record<string, string> = { binance: 'BN', hyperliquid: 'HL', bybit: 'BB' };

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-[15px] font-bold text-text1">Liquidation Monitor</h2>
          <p className="text-[11px] text-text3 mt-0.5">Real data from 4 perpetual exchanges · Pacifica markets only</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-text3">
          {loading && <span className="animate-spin text-accent">↻</span>}
          {meta && !loading && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
                {meta.totalEvents.toLocaleString()} events
              </span>
              <span>· {fmtAgo(meta.fetchedAt)}</span>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Time */}
        <div className="flex items-center gap-0.5 bg-surface border border-border1 rounded-xl p-1">
          {HOURS_OPTIONS.map(o => (
            <button key={o.value} onClick={() => setHours(o.value)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                hours === o.value ? 'bg-accent/15 text-accent border border-accent/30' : 'text-text3 hover:text-text2'}`}>
              {o.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3 text-[12px]">⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter..."
            className="bg-surface border border-border1 rounded-xl pl-7 pr-3 py-1.5 text-[11px] text-text1 outline-none focus:border-accent placeholder-text3 w-28" />
        </div>

        {/* Tab */}
        <div className="ml-auto flex items-center gap-0.5 bg-surface border border-border1 rounded-xl p-1">
          {(['table','feed'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                tab === t ? 'bg-surface2 text-text1 border border-border1' : 'text-text3 hover:text-text2'}`}>
              {t === 'table' ? '⊞ Table' : '≡ Feed'}
            </button>
          ))}
        </div>

        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-border1 rounded-xl text-[11px] text-text2 hover:text-text1 transition-colors disabled:opacity-40">
          <span className={loading ? 'animate-spin' : ''}>↻</span>
        </button>
      </div>

      {/* Grand totals bar */}
      {grandTotal > 0 && (
        <div className="flex items-center gap-4 px-4 py-2.5 bg-surface border border-border1 rounded-xl text-[11px]">
          <div className="flex flex-col">
            <span className="text-text3 text-[9px] uppercase font-semibold">Total Liquidated</span>
            <span className="text-text1 font-bold text-[14px]">{fmtV(grandTotal)}</span>
          </div>
          <div className="w-px h-8 bg-border1" />
          <div className="flex flex-col">
            <span className="text-text3 text-[9px] uppercase font-semibold">Long Liq</span>
            <span className="text-success font-bold text-[14px]">{fmtV(grandLong)}</span>
          </div>
          <div className="w-px h-8 bg-border1" />
          <div className="flex flex-col">
            <span className="text-text3 text-[9px] uppercase font-semibold">Short Liq</span>
            <span className="text-danger font-bold text-[14px]">{fmtV(grandShort)}</span>
          </div>
          {/* Ratio bar */}
          <div className="flex-1 ml-2">
            <div className="flex h-2 rounded-full overflow-hidden">
              <div className="bg-success/70 transition-all" style={{ width: `${grandTotal > 0 ? (grandLong/grandTotal)*100 : 50}%` }} />
              <div className="bg-danger/70 flex-1" />
            </div>
            <div className="flex justify-between mt-0.5 text-[9px] text-text3">
              <span>Long {grandTotal > 0 ? ((grandLong/grandTotal)*100).toFixed(0) : 50}%</span>
              <span>Short {grandTotal > 0 ? ((grandShort/grandTotal)*100).toFixed(0) : 50}%</span>
            </div>
          </div>
          <div className="w-px h-8 bg-border1" />
          <div className="flex items-center gap-2 text-[10px] text-text3">
            <span className="font-semibold">{filtered.length} markets</span>
            <span className="text-[9px]">· Click row for heatmap</span>
          </div>
        </div>
      )}

      {/* Table */}
      {tab === 'table' && (
        <div className="bg-surface border border-border1 rounded-2xl overflow-hidden flex-1 flex flex-col">
          {/* Header */}
          <div className="grid px-4 py-2.5 border-b border-border1 bg-surface2 text-[10px] uppercase tracking-wide"
            style={{ gridTemplateColumns: '44px 1fr 110px 100px 100px 55px 90px' }}>
            <span className="text-text3">#</span>
            <span className="text-text3">Symbol</span>
            <SortBtn col="total"  label="Total Liq" />
            <SortBtn col="long"   label="Long Liq"  />
            <SortBtn col="short"  label="Short Liq" />
            <SortBtn col="count"  label="Events"    />
            <span className="text-text3">Sources</span>
          </div>

          <div className="overflow-y-auto flex-1">
            {loading && filtered.length === 0 && (
              <div className="flex items-center justify-center py-20 text-text3 text-[12px] gap-2">
                <span className="animate-spin text-accent">↻</span> Fetching data...
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <span className="text-3xl">⚡</span>
                <span className="text-text2 text-[13px] font-semibold">No liquidation data</span>
                <span className="text-text3 text-[11px]">Try a wider time range</span>
              </div>
            )}

            {filtered.map((s, idx) => {
              const longPct  = s.total > 0 ? (s.longLiq / s.total) * 100 : 50;
              const shortPct = 100 - longPct;
              const bar      = Math.max(8, (s.total / maxTotal) * 100);
              const domLong  = longPct >= shortPct;

              return (
                <div key={s.symbol} onClick={() => setModalSymbol(s.symbol + '-USD')}
                  className="grid items-center px-4 py-2.5 border-b border-border1/40 hover:bg-surface2/60 transition-colors cursor-pointer"
                  style={{ gridTemplateColumns: '44px 1fr 110px 100px 100px 55px 90px' }}>

                  {/* # */}
                  <span className="text-[11px] text-text3 font-mono">{idx + 1}</span>

                  {/* Symbol */}
                  <div className="flex items-center gap-2">
                    <CoinLogo symbol={`${s.symbol}-USD`} size={20} />
                    <div>
                      <div className="text-[13px] font-bold text-text1 leading-none">{s.symbol}</div>
                      {/* Long/short ratio bar */}
                      <div className="flex mt-1 rounded-full overflow-hidden" style={{ width: bar, height: 3 }}>
                        <div className="bg-success/80" style={{ width: `${longPct}%` }} />
                        <div className="bg-danger/80"  style={{ width: `${shortPct}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Total */}
                  <div>
                    <span className="text-[13px] font-bold text-text1">{fmtV(s.total)}</span>
                    <div className={`text-[9px] font-semibold mt-0.5 ${domLong ? 'text-success' : 'text-danger'}`}>
                      {domLong ? '▲ Longs dominated' : '▼ Shorts dominated'}
                    </div>
                  </div>

                  {/* Long */}
                  <div>
                    <span className="text-[13px] font-semibold text-success">{fmtV(s.longLiq)}</span>
                    <div className="text-[9px] text-text3 mt-0.5">{longPct.toFixed(0)}%</div>
                  </div>

                  {/* Short */}
                  <div>
                    <span className="text-[13px] font-semibold text-danger">{fmtV(s.shortLiq)}</span>
                    <div className="text-[9px] text-text3 mt-0.5">{shortPct.toFixed(0)}%</div>
                  </div>

                  {/* Events */}
                  <span className="text-[12px] font-mono text-text2">{s.count}</span>

                  {/* Sources — mini stacked bars */}
                  <div className="flex items-end gap-1 h-6">
                    {Object.entries(s.byExchange).map(([ex, val]) => {
                      if (!val) return null;
                      const h = Math.max(4, Math.min(22, (val / s.total) * 24));
                      return (
                        <div key={ex} title={`${ex}: ${fmtV(val)}`}
                          className="flex flex-col items-center gap-0.5">
                          <div className="w-2 rounded-sm" style={{ height: h, background: SOURCE_COLORS[ex] ?? '#888' }} />
                          <span className="text-[7px] leading-none" style={{ color: SOURCE_COLORS[ex] ?? '#888' }}>
                            {SOURCE_SHORT[ex] ?? ex.slice(0,2).toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {filtered.length > 0 && (
            <div className="px-4 py-2 border-t border-border1 bg-surface2/50 flex items-center gap-4 text-[10px] text-text3 shrink-0">
              <span>{filtered.length} markets · {(meta?.totalEvents ?? 0).toLocaleString()} events total</span>
              <span className="ml-auto">
                <span className="text-success font-semibold">{fmtV(grandLong)}</span>
                <span className="mx-1">long /</span>
                <span className="text-danger font-semibold">{fmtV(grandShort)}</span>
                <span className="ml-1">short liq</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Feed */}
      {tab === 'feed' && (
        <div className="bg-surface border border-border1 rounded-2xl overflow-hidden flex-1 flex flex-col">
          <div className="grid px-4 py-2.5 border-b border-border1 bg-surface2 text-[10px] uppercase tracking-wide text-text3"
            style={{ gridTemplateColumns: '90px 1fr 75px 90px 100px 90px' }}>
            <span>Time</span><span>Symbol</span><span>Side</span>
            <span>Size</span><span>Source</span><span>Price</span>
          </div>

          <div className="overflow-y-auto flex-1">
            {loading && recent.length === 0 && (
              <div className="flex items-center justify-center py-20 text-text3 text-[12px] gap-2">
                <span className="animate-spin text-accent">↻</span> Loading feed...
              </div>
            )}
            {!loading && recent.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <span className="text-3xl">📭</span>
                <span className="text-text2 text-[13px] font-semibold">No recent liquidations</span>
                <span className="text-text3 text-[11px]">Try a wider time range</span>
              </div>
            )}

            {recent
              .filter(e => !search || e.symbol.toLowerCase().includes(search.toLowerCase()))
              .slice(0, 200)
              .map((e, i) => (
                <div key={e.id ?? i} onClick={() => setModalSymbol(e.symbol + '-USD')}
                  className="grid items-center px-4 py-2 border-b border-border1/30 hover:bg-surface2/50 cursor-pointer transition-colors"
                  style={{ gridTemplateColumns: '90px 1fr 75px 90px 100px 90px' }}>
                  <span className="font-mono text-[10px] text-text3">{fmtTime(e.ts)}</span>
                  <div className="flex items-center gap-1.5">
                    <CoinLogo symbol={`${e.symbol}-USD`} size={15} />
                    <span className="text-[12px] font-semibold text-text1">{e.symbol}</span>
                  </div>
                  <span className={`text-[10px] font-bold ${e.side === 'long' ? 'text-success' : 'text-danger'}`}>
                    {e.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                  </span>
                  <span className="text-[12px] font-mono font-semibold text-text1">{fmtV(e.notional)}</span>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: SOURCE_COLORS[e.exchange] ?? '#888' }} />
                    <span className="text-[10px] font-semibold" style={{ color: SOURCE_COLORS[e.exchange] ?? '#888' }}>
                      {e.exchange === 'hyperliquid' ? 'HyperLiq' : e.exchange === 'binance' ? 'Binance' : 'Bybit'}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-text2">
                    {e.price > 0 ? `$${e.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Heatmap Modal */}
      {modalSymbol && (
        <LiquidationHeatmapModal symbol={modalSymbol} onClose={() => setModalSymbol(null)} />
      )}
    </div>
  );
}
