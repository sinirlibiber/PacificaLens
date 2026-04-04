'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Market } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';

interface LiqEvent {
  id: string;
  exchange: 'hyperliquid' | 'binance' | 'bybit';
  symbol: string;
  side: 'long' | 'short';
  price: number;
  notional: number;
  ts: number;
}
interface LiqSymbolData {
  symbol: string;
  longLiq: number;
  shortLiq: number;
  total: number;
  count: number;
  byExchange: { hyperliquid: number; binance: number; bybit: number };
}
interface Meta {
  fetchedAt: number;
  hours: number;
  totalEvents: number;
  sources: { binance: number; hyperliquid: number; bybit: number };
}

interface HeatmapViewProps { markets: Market[]; defaultSymbol?: string; }

const HOURS_OPTIONS = [
  { label: '1h',  value: 1  },
  { label: '6h',  value: 6  },
  { label: '24h', value: 24 },
  { label: '7d',  value: 168 },
];
const EXCHANGES = ['all', 'binance', 'hyperliquid', 'bybit'] as const;
type ExchangeFilter = typeof EXCHANGES[number];

function fmtV(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const EX_COLOR: Record<string, string> = {
  binance:     '#F0B90B',
  hyperliquid: '#00E5CF',
  bybit:       '#F7A600',
};
const EX_LABEL: Record<string, string> = {
  binance: 'Binance', hyperliquid: 'HyperLiquid', bybit: 'Bybit',
};

export default function HeatmapView({ markets }: HeatmapViewProps) {
  const [summary,  setSummary ] = useState<LiqSymbolData[]>([]);
  const [recent,   setRecent  ] = useState<LiqEvent[]>([]);
  const [meta,     setMeta    ] = useState<Meta | null>(null);
  const [loading,  setLoading ] = useState(false);
  const [hours,    setHours   ] = useState(24);
  const [exchange, setExchange] = useState<ExchangeFilter>('all');
  const [search,   setSearch  ] = useState('');
  const [tab,      setTab     ] = useState<'table' | 'feed'>('table');
  const [sortBy,   setSortBy  ] = useState<'total' | 'long' | 'short' | 'count'>('total');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res  = await fetch(`/api/liq-multi?hours=${hours}&exchange=${exchange}`, { signal: ctrl.signal });
      const data = await res.json();
      if (!ctrl.signal.aborted) {
        setSummary(data.summary ?? []);
        setRecent(data.recent   ?? []);
        setMeta(data.meta       ?? null);
      }
    } catch { /* aborted or network error */ }
    finally { if (!ctrl.signal.aborted) setLoading(false); }
  }, [hours, exchange]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = summary
    .filter(s => s.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'long')  return b.longLiq  - a.longLiq;
      if (sortBy === 'short') return b.shortLiq - a.shortLiq;
      if (sortBy === 'count') return b.count    - a.count;
      return b.total - a.total;
    });

  const maxTotal = filtered[0]?.total ?? 1;

  const SortBtn = ({ col, label }: { col: typeof sortBy; label: string }) => (
    <button
      onClick={() => setSortBy(col)}
      className={`flex items-center gap-1 text-[11px] font-semibold transition-colors ${
        sortBy === col ? 'text-accent' : 'text-text3 hover:text-text2'
      }`}
    >
      {label}
      {sortBy === col && <span className="text-[9px]">▼</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-text1">Liquidation Monitor</h2>
          <p className="text-[11px] text-text3 mt-0.5">
            Real data from Binance · HyperLiquid · Bybit — Pacifica markets only
          </p>
        </div>
        {meta && (
          <div className="flex items-center gap-3 text-[10px] text-text3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
              {meta.totalEvents.toLocaleString()} events
            </span>
            <span>Updated {fmtAgo(meta.fetchedAt)}</span>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Time range */}
        <div className="flex items-center gap-1 bg-surface border border-border1 rounded-xl p-1">
          {HOURS_OPTIONS.map(o => (
            <button key={o.value} onClick={() => setHours(o.value)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                hours === o.value
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-text3 hover:text-text2'
              }`}>
              {o.label}
            </button>
          ))}
        </div>

        {/* Exchange filter */}
        <div className="flex items-center gap-1 bg-surface border border-border1 rounded-xl p-1">
          {EXCHANGES.map(ex => (
            <button key={ex} onClick={() => setExchange(ex)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all capitalize ${
                exchange === ex
                  ? 'bg-surface2 text-text1 border border-border1'
                  : 'text-text3 hover:text-text2'
              }`}
              style={exchange === ex && ex !== 'all' ? { color: EX_COLOR[ex] } : {}}>
              {ex === 'all' ? 'All' : EX_LABEL[ex]}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3 text-[11px]">⌕</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter symbol..."
            className="bg-surface border border-border1 rounded-xl pl-7 pr-3 py-1.5 text-[11px] text-text1 outline-none focus:border-accent placeholder-text3 w-36"
          />
        </div>

        {/* Tabs */}
        <div className="ml-auto flex items-center gap-1 bg-surface border border-border1 rounded-xl p-1">
          {(['table', 'feed'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all ${
                tab === t ? 'bg-surface2 text-text1 border border-border1' : 'text-text3 hover:text-text2'
              }`}>
              {t === 'table' ? '⊞ Table' : '≡ Live Feed'}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border1 rounded-xl text-[11px] text-text2 hover:text-text1 transition-colors disabled:opacity-50">
          <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* ── Source badges ── */}
      {meta && (
        <div className="flex items-center gap-2">
          {Object.entries(meta.sources).map(([ex, count]) => count > 0 && (
            <span key={ex} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border"
              style={{ background: `${EX_COLOR[ex]}12`, borderColor: `${EX_COLOR[ex]}30`, color: EX_COLOR[ex] }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: EX_COLOR[ex] }} />
              {EX_LABEL[ex]} · {count} events
            </span>
          ))}
        </div>
      )}

      {/* ── Table view ── */}
      {tab === 'table' && (
        <div className="bg-surface border border-border1 rounded-2xl overflow-hidden flex-1">
          {/* Table header */}
          <div className="grid text-[10px] font-semibold text-text3 uppercase tracking-wide px-4 py-2.5 border-b border-border1 bg-surface2"
            style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 60px 1fr' }}>
            <span>Symbol</span>
            <SortBtn col="total"  label="Total Liq" />
            <SortBtn col="long"   label="Long Liq"  />
            <SortBtn col="short"  label="Short Liq" />
            <SortBtn col="count"  label="Events"    />
            <span>Sources</span>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
            {loading && filtered.length === 0 && (
              <div className="flex items-center justify-center py-16 text-text3 text-[12px]">
                <span className="animate-spin mr-2">↻</span> Loading liquidation data...
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-text3">
                <span className="text-2xl mb-2">⚡</span>
                <span className="text-[12px]">No liquidation data found</span>
                <span className="text-[10px] mt-1">Try a different time range or exchange</span>
              </div>
            )}

            {filtered.map((s, idx) => {
              const longPct  = s.total > 0 ? (s.longLiq  / s.total) * 100 : 50;
              const shortPct = 100 - longPct;
              const barWidth = Math.max(4, (s.total / maxTotal) * 100);
              const domSide  = longPct > shortPct ? 'long' : 'short';

              return (
                <div key={s.symbol}
                  className="grid items-center px-4 py-3 border-b border-border1/50 hover:bg-surface2/50 transition-colors"
                  style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 60px 1fr' }}>

                  {/* Symbol */}
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-text3 w-5 text-right">{idx + 1}</span>
                    <CoinLogo symbol={`${s.symbol}-USD`} size={22} />
                    <div>
                      <div className="text-[13px] font-bold text-text1">{s.symbol}</div>
                      {/* Bar */}
                      <div className="flex items-center gap-0.5 mt-1" style={{ width: 80 }}>
                        <div className="h-1 rounded-l-full bg-success/70 transition-all"
                          style={{ width: `${(longPct / 100) * barWidth}%` }} />
                        <div className="h-1 rounded-r-full bg-danger/70 transition-all"
                          style={{ width: `${(shortPct / 100) * barWidth}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Total */}
                  <div>
                    <div className="text-[13px] font-bold text-text1">{fmtV(s.total)}</div>
                    <div className={`text-[10px] font-semibold mt-0.5 ${domSide === 'long' ? 'text-success' : 'text-danger'}`}>
                      {domSide === 'long' ? '▲ Long dom.' : '▼ Short dom.'}
                    </div>
                  </div>

                  {/* Long liq */}
                  <div className="text-[13px] font-semibold text-success">
                    {fmtV(s.longLiq)}
                    <div className="text-[10px] text-text3 font-normal">{longPct.toFixed(0)}%</div>
                  </div>

                  {/* Short liq */}
                  <div className="text-[13px] font-semibold text-danger">
                    {fmtV(s.shortLiq)}
                    <div className="text-[10px] text-text3 font-normal">{shortPct.toFixed(0)}%</div>
                  </div>

                  {/* Count */}
                  <div className="text-[12px] text-text2 font-mono">{s.count}</div>

                  {/* Exchange breakdown */}
                  <div className="flex items-center gap-1.5">
                    {Object.entries(s.byExchange).map(([ex, val]) => val > 0 && (
                      <div key={ex} className="flex flex-col items-center"
                        title={`${EX_LABEL[ex]}: ${fmtV(val)}`}>
                        <div className="w-1 rounded-full" style={{
                          height: Math.max(4, Math.min(20, (val / s.total) * 24)),
                          background: EX_COLOR[ex],
                          opacity: 0.8,
                        }} />
                        <span className="text-[8px] mt-0.5" style={{ color: EX_COLOR[ex] }}>
                          {ex === 'hyperliquid' ? 'HL' : ex === 'binance' ? 'BN' : 'BB'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer summary */}
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border1 bg-surface2 flex items-center gap-4 text-[10px] text-text3">
              <span>{filtered.length} markets</span>
              <span>Total: <span className="text-text1 font-semibold">{fmtV(filtered.reduce((s, x) => s + x.total, 0))}</span></span>
              <span>Long liq: <span className="text-success font-semibold">{fmtV(filtered.reduce((s, x) => s + x.longLiq, 0))}</span></span>
              <span>Short liq: <span className="text-danger font-semibold">{fmtV(filtered.reduce((s, x) => s + x.shortLiq, 0))}</span></span>
            </div>
          )}
        </div>
      )}

      {/* ── Live Feed view ── */}
      {tab === 'feed' && (
        <div className="bg-surface border border-border1 rounded-2xl overflow-hidden flex-1">
          <div className="grid text-[10px] font-semibold text-text3 uppercase tracking-wide px-4 py-2.5 border-b border-border1 bg-surface2"
            style={{ gridTemplateColumns: '100px 1fr 80px 100px 1fr 80px' }}>
            <span>Time</span>
            <span>Symbol</span>
            <span>Side</span>
            <span>Size</span>
            <span>Exchange</span>
            <span>Price</span>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
            {loading && recent.length === 0 && (
              <div className="flex items-center justify-center py-16 text-text3 text-[12px]">
                <span className="animate-spin mr-2">↻</span> Loading feed...
              </div>
            )}
            {!loading && recent.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-text3">
                <span className="text-2xl mb-2">📭</span>
                <span className="text-[12px]">No recent liquidations</span>
              </div>
            )}

            {recent
              .filter(e => search ? e.symbol.toLowerCase().includes(search.toLowerCase()) : true)
              .slice(0, 200)
              .map(e => (
              <div key={e.id}
                className="grid items-center px-4 py-2.5 border-b border-border1/40 hover:bg-surface2/50 transition-colors text-[12px]"
                style={{ gridTemplateColumns: '100px 1fr 80px 100px 1fr 80px' }}>

                <div className="font-mono text-text3 text-[10px]">{fmtTime(e.ts)}</div>

                <div className="flex items-center gap-2">
                  <CoinLogo symbol={`${e.symbol}-USD`} size={16} />
                  <span className="font-semibold text-text1">{e.symbol}</span>
                </div>

                <div className={`font-bold text-[11px] ${e.side === 'long' ? 'text-success' : 'text-danger'}`}>
                  {e.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                </div>

                <div className="font-mono font-semibold text-text1">{fmtV(e.notional)}</div>

                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: EX_COLOR[e.exchange] }} />
                  <span style={{ color: EX_COLOR[e.exchange] }} className="text-[10px] font-semibold">
                    {EX_LABEL[e.exchange]}
                  </span>
                </div>

                <div className="font-mono text-text2 text-[10px]">
                  {e.price > 0 ? `$${e.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
