'use client';

import { useState, useMemo } from 'react';
import { Market, Ticker } from '@/lib/pacifica';
import { useWhaleWatcher, WhaleTrade, SymbolPressure } from '@/hooks/useWhaleWatcher';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice, getMarkPrice, get24hChange } from '@/lib/utils';
import { CalcResult } from './Calculator';

interface Props {
  markets: Market[];
  tickers: Record<string, Ticker>;
  wallet: string | null;
  onExecute: (r: CalcResult, symbol: string) => void;
  accountInfo?: import('@/lib/pacifica').AccountInfo | null;
}

function fmtN(n: number) {
  if (n >= 1e9) return '$' + fmt(n / 1e9, 2) + 'B';
  if (n >= 1e6) return '$' + fmt(n / 1e6, 2) + 'M';
  if (n >= 1e3) return '$' + fmt(n / 1e3, 1) + 'K';
  return '$' + fmt(n, 0);
}

type SortDir = 'asc' | 'desc';

function Th({ label, sortKey, cur, dir, onClick }: {
  label: string; sortKey: string; cur: string; dir: SortDir; onClick: () => void;
}) {
  const active = cur === sortKey;
  return (
    <th onClick={onClick}
      className="px-3 py-2 text-[10px] font-semibold text-text3 uppercase tracking-wide text-left cursor-pointer hover:text-accent select-none whitespace-nowrap">
      {label}
      <span className={'ml-1 ' + (active ? 'text-accent' : 'text-border2')}>
        {active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}
      </span>
    </th>
  );
}

// ─── Position Detail Modal ────────────────────────────────────────────────────
function PositionDetailModal({
  p, tickers, markets, recentTrades, wallet, onExecute, onClose
}: {
  p: SymbolPressure;
  tickers: Record<string, Ticker>;
  markets: Market[];
  recentTrades: WhaleTrade[];
  wallet: string | null;
  onExecute: (r: CalcResult, symbol: string) => void;
  onClose: () => void;
}) {
  const [detailTab, setDetailTab] = useState<'overview' | 'trades'>('overview');

  const tk = tickers[p.symbol];
  const market = markets.find(m => m.symbol === p.symbol);
  const price = getMarkPrice(tk);
  const chg = get24hChange(tk);
  const oi = Number(tk?.open_interest || 0);
  const funding = Number(tk?.funding || 0) * 100;
  const volume = Number(tk?.volume_24h || 0);

  const symbolTrades = recentTrades.filter(t => t.symbol === p.symbol);
  const dominantSide: 'long' | 'short' = p.bullScore >= 50 ? 'long' : 'short';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-surface border border-border1 rounded-2xl shadow-card-md w-[640px] max-h-[85vh] overflow-hidden flex flex-col"
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className={'px-6 py-4 border-b border-border1 flex items-center justify-between shrink-0 ' +
            (p.bullScore > 55 ? 'bg-success/5' : p.bearScore > 55 ? 'bg-danger/5' : 'bg-surface2')}>
            <div className="flex items-center gap-3">
              <CoinLogo symbol={p.symbol} size={44} />
              <div>
                <div className="text-[18px] font-bold text-text1">{p.symbol}-PERP</div>
                <div className="text-[11px] text-text3 mt-0.5">{p.tradeCount} whale trades · {fmtN(p.totalWhaleFlow)} total flow</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className={'text-[22px] font-bold ' + (chg >= 0 ? 'text-success' : 'text-danger')}>${fmtPrice(price)}</div>
                <div className={'text-[11px] font-semibold ' + (chg >= 0 ? 'text-success' : 'text-danger')}>
                  {chg >= 0 ? '+' : ''}{fmt(chg, 2)}% 24h
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface2 text-text3 text-xl ml-2">×</button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-border1 bg-surface shrink-0">
            {[['overview', 'Overview'], ['trades', 'Recent Whale Trades']].map(([k, l]) => (
              <button key={k} onClick={() => setDetailTab(k as 'overview' | 'trades')}
                className={'px-5 py-2.5 text-[11px] font-semibold border-b-2 transition-all ' +
                  (detailTab === k ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {detailTab === 'overview' && (
              <div className="p-5 space-y-4">
                {/* Market stats */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { l: 'Open Interest', v: fmtN(oi), c: 'text-accent' },
                    { l: '24h Volume', v: fmtN(volume), c: 'text-text1' },
                    { l: 'Funding/8h', v: (funding >= 0 ? '+' : '') + fmt(funding, 4) + '%', c: funding >= 0 ? 'text-danger' : 'text-success' },
                    { l: 'Max Leverage', v: (market?.max_leverage || '?') + 'x', c: 'text-text2' },
                  ].map(s => (
                    <div key={s.l} className="bg-surface2 rounded-xl p-3 border border-border1">
                      <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.l}</div>
                      <div className={'text-[15px] font-bold ' + s.c}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Bull/Bear pressure */}
                <div className="bg-surface2 border border-border1 rounded-xl p-4">
                  <div className="flex justify-between text-[11px] mb-2">
                    <span className="text-success font-bold">🟢 Long Pressure {p.bullScore}%</span>
                    <span className="text-danger font-bold">Short Pressure {p.bearScore}% 🔴</span>
                  </div>
                  <div className="flex h-4 rounded-full overflow-hidden border border-border1">
                    <div className="bg-success flex items-center justify-center text-[9px] text-white font-bold transition-all" style={{ width: p.bullScore + '%' }}>
                      {p.bullScore > 20 ? p.bullScore + '%' : ''}
                    </div>
                    <div className="bg-danger flex items-center justify-center text-[9px] text-white font-bold transition-all" style={{ width: p.bearScore + '%' }}>
                      {p.bearScore > 20 ? p.bearScore + '%' : ''}
                    </div>
                  </div>
                </div>

                {/* Flow breakdown */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { l: 'Long Flow', v: fmtN(p.longNotional), c: 'text-success', icon: '↑' },
                    { l: 'Short Flow', v: fmtN(p.shortNotional), c: 'text-danger', icon: '↓' },
                    { l: 'Liq. Longs', v: fmtN(p.liqLong), c: p.liqLong > 0 ? 'text-danger' : 'text-text3', icon: '⚡' },
                    { l: 'Liq. Shorts', v: fmtN(p.liqShort), c: p.liqShort > 0 ? 'text-success' : 'text-text3', icon: '⚡' },
                  ].map(f => (
                    <div key={f.l} className="bg-surface2 rounded-xl p-3 border border-border1 flex items-center gap-3">
                      <span className={'text-[18px] ' + f.c}>{f.icon}</span>
                      <div>
                        <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide">{f.l}</div>
                        <div className={'text-[16px] font-bold ' + f.c}>{f.v}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Alerts */}
                <div className="space-y-2">
                  {p.fundingSpike && (
                    <div className="bg-warn/8 border border-warn/25 rounded-xl p-3 text-[11px] text-warn flex items-center gap-2">
                      ⚡ Funding rate spike — elevated holding cost detected
                    </div>
                  )}
                  {p.oiChange !== 0 && (
                    <div className={'rounded-xl p-3 text-[11px] border ' + (p.oiChange > 0 ? 'bg-success/5 border-success/20 text-success' : 'bg-danger/5 border-danger/20 text-danger')}>
                      {p.oiChange > 0 ? '↑ New money entering' : '↓ Positions closing'} · OI {p.oiChange > 0 ? '+' : ''}{fmt(p.oiChange, 1)}%
                    </div>
                  )}
                </div>
              </div>
            )}

            {detailTab === 'trades' && (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-surface2 border-b border-border1">
                    <tr>
                      <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-left">Action</th>
                      <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-right">Size</th>
                      <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-right">Price</th>
                      <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-left">Type</th>
                      <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbolTrades.length > 0 ? symbolTrades.map(t => {
                      const isLong = t.side.includes('long');
                      const isOpen = t.side.startsWith('open');
                      return (
                        <tr key={t.id} className="border-b border-border1 hover:bg-surface2/40">
                          <td className="px-4 py-2.5">
                            <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' +
                              (t.isLiquidation ? 'bg-danger/10 text-danger' : isLong && isOpen ? 'bg-success/10 text-success' : !isLong && isOpen ? 'bg-danger/10 text-danger' : 'bg-surface2 text-text3')}>
                              {t.isLiquidation ? '⚡ LIQ' : ''} {t.side.replace('_', ' ').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-accent">{fmtN(t.notional)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text2">${fmtPrice(t.price)}</td>
                          <td className="px-4 py-2.5 text-text3">{t.isLiquidation ? (t.cause === 'backstop_liquidation' ? 'Backstop' : 'Market Liq') : isOpen ? 'Open' : 'Close'}</td>
                          <td className="px-4 py-2.5 text-right text-text3 text-[10px]">{new Date(t.ts).toLocaleTimeString()}</td>
                                                  </tr>
                      );
                    }) : (
                      <tr><td colSpan={6} className="py-10 text-center text-text3">No whale trades detected for {p.symbol} yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>{/* bg-surface modal */}
      </div>{/* fixed overlay */}
    </>
  );
}

// ─── Trade Detail Modal ────────────────────────────────────────────────────────
function TradeDetailModal({ t, onClose }: { t: WhaleTrade; onClose: () => void }) {
  const isLong = t.side.includes('long');
  const isOpen = t.side.startsWith('open');
  const isLiq = t.isLiquidation;
  const impact = t.notional >= 1e6 ? 'HIGH' : t.notional >= 250000 ? 'MEDIUM' : 'LOW';
  const impactColor = impact === 'HIGH' ? 'text-danger' : impact === 'MEDIUM' ? 'text-warn' : 'text-text3';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-border1 rounded-2xl w-[440px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={'px-6 py-4 border-b border-border1 flex items-center justify-between ' + (isLiq ? 'bg-danger/5' : isLong && isOpen ? 'bg-success/5' : 'bg-surface2')}>
          <div className="flex items-center gap-3">
            <CoinLogo symbol={t.symbol} size={36} />
            <div>
              <div className="text-[15px] font-bold text-text1">{t.symbol}-PERP</div>
              <div className="text-[10px] text-text3">{new Date(t.ts).toLocaleString()}</div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface2 text-text3 text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {isLiq && <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-danger/10 text-danger border border-danger/20">⚡ LIQUIDATION</span>}
            <span className={'text-[10px] font-bold px-2.5 py-1 rounded-full border ' + (isLong && isOpen ? 'bg-success/10 text-success border-success/20' : !isLong && isOpen ? 'bg-danger/10 text-danger border-danger/20' : 'bg-surface2 text-text3 border-border1')}>
              {t.side.replace('_', ' ').toUpperCase()}
            </span>
            <span className={'text-[10px] font-bold px-2.5 py-1 rounded-full bg-surface2 border border-border1 ' + impactColor}>{impact} IMPACT</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { l: 'Notional', v: fmtN(t.notional), big: true, c: 'text-accent' },
              { l: 'Price', v: '$' + fmtPrice(t.price), big: true, c: 'text-text1' },
              { l: 'Size', v: fmt(t.amount, 4), big: false, c: 'text-text2' },
              { l: 'Type', v: isLiq ? (t.cause === 'backstop_liquidation' ? 'Backstop' : 'Market Liq') : isOpen ? 'Open' : 'Close', big: false, c: isLiq ? 'text-danger' : isOpen ? 'text-success' : 'text-text3' },
            ].map(f => (
              <div key={f.l} className="bg-surface2 rounded-xl p-3 border border-border1">
                <div className="text-[9px] text-text3 uppercase font-semibold mb-1">{f.l}</div>
                <div className={'font-bold ' + (f.big ? 'text-[18px]' : 'text-[13px]') + ' ' + f.c}>{f.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function WhaleWatcher({ markets, tickers, wallet, onExecute, accountInfo }: Props) {
  const { whaleTrades, pressureMap, isScanning, lastScan } = useWhaleWatcher(markets, tickers, 5000);

  const [posModal, setPosModal] = useState<SymbolPressure | null>(null);
  const [traderWallet, setTraderWallet] = useState<string | null>(null);
  const [walletInput, setWalletInput] = useState('');
  const [tradeModal, setTradeModal] = useState<WhaleTrade | null>(null);

  // Big Positions
  const [bpSearch, setBpSearch] = useState('');
  const [bpSide, setBpSide] = useState<'all' | 'long' | 'short'>('all');
  const [bpMinFlow, setBpMinFlow] = useState(0);
  const [bpSort, setBpSort] = useState<'flow' | 'bull' | 'trades' | 'liq'>('flow');
  const [bpDir, setBpDir] = useState<SortDir>('desc');

  // Liquidations
  const [liqSearch, setLiqSearch] = useState('');
  const [liqSide, setLiqSide] = useState<'all' | 'long' | 'short'>('all');
  const [liqMin, setLiqMin] = useState(500);
  const [liqSort, setLiqSort] = useState<'ts' | 'notional'>('ts');
  const [liqDir, setLiqDir] = useState<SortDir>('desc');

  function tog<T extends string>(cur: T, next: T, dir: SortDir, setS: (v: T) => void, setD: (v: SortDir) => void) {
    if (cur === next) setD(dir === 'desc' ? 'asc' : 'desc');
    else { setS(next); setD('desc'); }
  }

  const bigPositions = useMemo(() => {
    let rows = Object.values(pressureMap).filter(p => p.totalWhaleFlow >= bpMinFlow || p.tradeCount > 0);
    if (bpSearch) rows = rows.filter(p => p.symbol.toLowerCase().includes(bpSearch.toLowerCase()));
    if (bpSide === 'long') rows = rows.filter(p => p.bullScore >= 55);
    if (bpSide === 'short') rows = rows.filter(p => p.bearScore >= 55);
    rows.sort((a, b) => {
      const d = bpDir === 'desc' ? -1 : 1;
      if (bpSort === 'flow') return (a.totalWhaleFlow - b.totalWhaleFlow) * d;
      if (bpSort === 'bull') return (a.bullScore - b.bullScore) * d;
      if (bpSort === 'trades') return (a.tradeCount - b.tradeCount) * d;
      if (bpSort === 'liq') return ((a.liqLong + a.liqShort) - (b.liqLong + b.liqShort)) * d;
      return 0;
    });
    return rows;
  }, [pressureMap, bpSearch, bpSide, bpMinFlow, bpSort, bpDir]);

  const liquidations = useMemo(() => {
    let rows = whaleTrades.filter(t => t.isLiquidation && t.notional >= liqMin);
    if (liqSearch) rows = rows.filter(t => t.symbol.toLowerCase().includes(liqSearch.toLowerCase()));
    if (liqSide === 'long') rows = rows.filter(t => t.side.includes('long'));
    if (liqSide === 'short') rows = rows.filter(t => t.side.includes('short'));
    return rows.sort((a, b) => {
      const d = liqDir === 'desc' ? -1 : 1;
      return liqSort === 'ts' ? (a.ts - b.ts) * d : (a.notional - b.notional) * d;
    });
  }, [whaleTrades, liqSearch, liqSide, liqMin, liqSort, liqDir]);

  const totalLiqVol = whaleTrades.filter(t => t.isLiquidation).reduce((s, t) => s + t.notional, 0);

  const filterBtn = (active: boolean, color = 'accent') =>
    'px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ' +
    (active ? (color === 'danger' ? 'bg-danger text-white' : 'bg-accent text-white') : 'text-text3 hover:text-text2 bg-surface2');

  return (
    <div className="flex-1 overflow-auto bg-bg p-4 space-y-4">

      {/* Wallet Lookup */}
      <div className="bg-surface border border-border1 rounded-xl p-3 flex items-center gap-3">
        <div className="text-[10px] text-text3 font-semibold uppercase tracking-wide shrink-0">Lookup Trader</div>
        <input
          value={walletInput}
          onChange={e => setWalletInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && walletInput.trim().length > 10) setTraderWallet(walletInput.trim()); }}
          placeholder="Enter wallet address to view on Pacifica..."
          className="flex-1 bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[11px] font-mono outline-none focus:border-accent text-text1"
        />
        <button
          onClick={() => { if (walletInput.trim().length > 10) setTraderWallet(walletInput.trim()); }}
          disabled={walletInput.trim().length < 10}
          className="px-4 py-2 bg-accent text-white text-[11px] font-bold rounded-lg hover:bg-accent2 transition-colors disabled:opacity-40 shrink-0">
          View Trader
        </button>
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-text1">Smart Money</h2>
          <div className="text-[10px] text-text3 mt-0.5 flex items-center gap-1.5">
            {isScanning && <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />}
            {lastScan ? `Updated ${lastScan.toLocaleTimeString()}` : 'Starting scan...'}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { l: 'Liq Volume', v: fmtN(totalLiqVol), c: 'text-danger' },
            { l: 'Liq Events', v: String(whaleTrades.filter(t => t.isLiquidation).length), c: 'text-danger' },
            { l: 'Markets', v: String(Object.keys(pressureMap).length), c: 'text-text1' },
          ].map(s => (
            <div key={s.l} className="bg-surface border border-border1 rounded-xl px-3 py-2 text-center">
              <div className="text-[9px] text-text3 uppercase font-semibold">{s.l}</div>
              <div className={'text-[14px] font-bold ' + s.c}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Big Positions */}
      <div className="bg-surface border border-border1 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center gap-3 flex-wrap">
          <h3 className="text-[12px] font-bold text-text1 flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-accent" />Big Positions
            <span className="text-[10px] text-text3 font-normal">({bigPositions.length}) · click for details</span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={bpSearch} onChange={e => setBpSearch(e.target.value)} placeholder="Search..."
              className="bg-bg border border-border1 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-accent w-24" />
            <div className="flex bg-bg border border-border1 rounded-lg overflow-hidden">
              {(['all', 'long', 'short'] as const).map(s => (
                <button key={s} onClick={() => setBpSide(s)} className={filterBtn(bpSide === s) + ' capitalize text-[10px]'}>{s}</button>
              ))}
            </div>
            <div className="flex bg-bg border border-border1 rounded-lg overflow-hidden">
              {[0, 10000, 50000, 100000].map(v => (
                <button key={v} onClick={() => setBpMinFlow(v)} className={filterBtn(bpMinFlow === v) + ' text-[10px]'}>
                  {v === 0 ? 'All' : '$' + v/1000 + 'K+'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-surface2/60">
              <tr>
                <th className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">Market</th>
                <th className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">Bias</th>
                <Th label="Bull/Bear" sortKey="bull" cur={bpSort} dir={bpDir} onClick={() => tog(bpSort, 'bull', bpDir, setBpSort, setBpDir)} />
                <Th label="Whale Flow" sortKey="flow" cur={bpSort} dir={bpDir} onClick={() => tog(bpSort, 'flow', bpDir, setBpSort, setBpDir)} />
                <Th label="Trades" sortKey="trades" cur={bpSort} dir={bpDir} onClick={() => tog(bpSort, 'trades', bpDir, setBpSort, setBpDir)} />
                <Th label="Liq Vol" sortKey="liq" cur={bpSort} dir={bpDir} onClick={() => tog(bpSort, 'liq', bpDir, setBpSort, setBpDir)} />
                <th className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">OI</th>
              </tr>
            </thead>
            <tbody>
              {bigPositions.length > 0 ? bigPositions.map(p => {
                const tk = tickers[p.symbol];
                const chg = get24hChange(tk);
                const isL = p.bullScore >= 55, isS = p.bearScore >= 55;
                return (
                  <tr key={p.symbol} className="hover:bg-surface2/50 cursor-pointer border-b border-border1 last:border-0" onClick={() => setPosModal(p)}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <CoinLogo symbol={p.symbol} size={20} />
                        <div>
                          <div className="font-semibold text-text1">{p.symbol}</div>
                          <div className={'text-[9px] font-mono ' + (chg >= 0 ? 'text-success' : 'text-danger')}>{chg >= 0 ? '+' : ''}{fmt(chg, 2)}%</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' + (isL ? 'bg-success/10 text-success' : isS ? 'bg-danger/10 text-danger' : 'bg-surface2 text-text3')}>
                        {isL ? '↑ LONG' : isS ? '↓ SHORT' : '— NEU'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="flex h-1.5 w-16 rounded-full overflow-hidden">
                          <div className="bg-success" style={{ width: p.bullScore + '%' }} />
                          <div className="bg-danger" style={{ width: p.bearScore + '%' }} />
                        </div>
                        <span className="text-[10px] text-text3 font-mono">{p.bullScore}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold text-accent">{fmtN(p.totalWhaleFlow)}</td>
                    <td className="px-3 py-2 font-mono text-text2">{p.tradeCount}</td>
                    <td className={'px-3 py-2 font-mono ' + ((p.liqLong + p.liqShort) > 0 ? 'text-danger' : 'text-text3')}>
                      {fmtN(p.liqLong + p.liqShort)}
                    </td>
                    <td className="px-3 py-2">
                      {p.oiChange !== 0
                        ? <span className={'text-[9px] font-semibold ' + (p.oiChange > 0 ? 'text-success' : 'text-danger')}>{p.oiChange > 0 ? '↑' : '↓'}{fmt(Math.abs(p.oiChange), 1)}%</span>
                        : <span className="text-text3">—</span>}
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={7} className="py-10 text-center text-text3 text-sm">
                  {isScanning ? '🔍 Scanning markets...' : 'No data yet'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Liquidations */}
      <div className="bg-surface border border-border1 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-[12px] font-bold text-text1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-danger" />Liquidations
            <span className="text-[10px] text-text3 font-normal">({liquidations.length}) · {fmtN(liquidations.reduce((s, t) => s + t.notional, 0))}</span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={liqSearch} onChange={e => setLiqSearch(e.target.value)} placeholder="Search..."
              className="bg-bg border border-border1 rounded-lg px-2 py-1 text-[10px] outline-none focus:border-accent w-20" />
            <div className="flex bg-bg border border-border1 rounded-lg overflow-hidden">
              {(['all', 'long', 'short'] as const).map(s => (
                <button key={s} onClick={() => setLiqSide(s)} className={filterBtn(liqSide === s, 'danger') + ' capitalize text-[10px]'}>{s}</button>
              ))}
            </div>
            <div className="flex bg-bg border border-border1 rounded-lg overflow-hidden">
              {[500, 1000, 5000, 10000, 50000, 100000].map(v => (
                <button key={v} onClick={() => setLiqMin(v)} className={filterBtn(liqMin === v, 'danger') + ' text-[10px]'}>
                  ${v >= 1000 ? v/1000 + 'K' : v}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-surface2/60">
              <tr>
                <th className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">Market</th>
                <th className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">Side</th>
                <th className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-left">Type</th>
                <Th label="Size" sortKey="notional" cur={liqSort} dir={liqDir} onClick={() => tog(liqSort, 'notional', liqDir, setLiqSort, setLiqDir)} />
                <th className="px-3 py-2 text-[10px] text-text3 font-semibold uppercase text-right">Price</th>
                <Th label="Time" sortKey="ts" cur={liqSort} dir={liqDir} onClick={() => tog(liqSort, 'ts', liqDir, setLiqSort, setLiqDir)} />
              </tr>
            </thead>
            <tbody>
              {liquidations.length > 0 ? liquidations.slice(0, 60).map(t => (
                <tr key={t.id} className="hover:bg-surface2/40 cursor-pointer border-b border-border1 last:border-0" onClick={() => setTradeModal(t)}>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><CoinLogo symbol={t.symbol} size={18} /><span className="font-semibold text-text1">{t.symbol}</span></div></td>
                  <td className="px-3 py-2">
                    <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' + (t.side.includes('long') ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success')}>
                      LIQ {t.side.includes('long') ? 'LONG' : 'SHORT'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text3">{t.cause === 'backstop_liquidation' ? 'Backstop' : 'Market'}</td>
                  <td className="px-3 py-2 font-mono font-bold text-danger">{fmtN(t.notional)}</td>
                  <td className="px-3 py-2 font-mono text-text2 text-right">${fmtPrice(t.price)}</td>
                  <td className="px-3 py-2 text-text3 text-[10px]">{new Date(t.ts).toLocaleTimeString()}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="py-8 text-center text-text3 text-sm">
                  No liquidations ≥ ${liqMin >= 1000 ? liqMin/1000 + 'K' : liqMin} detected yet
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trader lookup — redirects to Copy tab */}
      {traderWallet && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setTraderWallet(null)}>
          <div className="bg-surface border border-border1 rounded-2xl shadow-card-md p-6 max-w-sm w-full mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-text1">View Trader</h3>
              <button onClick={() => setTraderWallet(null)} className="text-text3 hover:text-text1 text-xl">×</button>
            </div>
            <div className="bg-surface2 border border-border1 rounded-xl px-3 py-2 mb-4">
              <div className="text-[10px] text-text3 mb-1">Wallet Address</div>
              <div className="text-[11px] font-mono text-text1 break-all">{traderWallet}</div>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => { navigator.clipboard.writeText(traderWallet); }}
                className="w-full py-2 text-[12px] font-semibold border border-border1 rounded-xl text-text2 hover:border-accent/40 hover:text-accent transition-all">
                Copy Address
              </button>
              <a href={`https://app.pacifica.fi/portfolio/${traderWallet}`} target="_blank" rel="noopener noreferrer"
                className="block w-full py-2 text-[12px] font-semibold text-center bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors">
                View on Pacifica →
              </a>
              <div className="text-[10px] text-text3 text-center mt-2">
                To copy trades from this trader, add them from the <span className="text-accent font-semibold">Smart Money</span> tab leaderboard
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {posModal && (
        <PositionDetailModal
          p={posModal}
          tickers={tickers}
          markets={markets}
          recentTrades={whaleTrades}
          wallet={wallet}
          onExecute={onExecute}
          onClose={() => setPosModal(null)}
        />
      )}
      {tradeModal && <TradeDetailModal t={tradeModal} onClose={() => setTradeModal(null)} />}
    </div>
  );
}
