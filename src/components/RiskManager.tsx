'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calculator, CalcResult } from './Calculator';
import { Results } from './Results';
import { StatsBar } from './StatsBar';
import { MarketList } from './MarketList';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice, getMarkPrice } from '@/lib/utils';
import { Market, Ticker, FundingRate, Position, AccountInfo } from '@/lib/pacifica';
import { useOrderLog } from '@/hooks/useOrderLog';

interface RiskManagerProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  fundingRates: Record<string, FundingRate>;
  positions: Position[];
  accountInfo: AccountInfo | null;
  accountSize: number;
  onAccountSizeChange: (v: number) => void;
  wallet: string | null;
  error?: string | null;
  onExecute: (r: CalcResult, symbol: string) => void;
}

type RiskTab = 'results' | 'portfolio';

const CORR_GROUPS: Record<string, string> = {
  BTC: 'BTC', ETH: 'ETH', SOL: 'ALT', BNB: 'ALT', AVAX: 'ALT',
  MATIC: 'ALT', ARB: 'ALT', OP: 'ALT', LINK: 'ALT', DOT: 'ALT',
  ADA: 'ALT', ATOM: 'ALT', NEAR: 'ALT', APT: 'ALT', SUI: 'ALT',
  INJ: 'ALT', TIA: 'ALT', SEI: 'ALT', STRK: 'ALT', JUP: 'ALT',
  XRP: 'XRP', LTC: 'LTC', BCH: 'BCH',
  DOGE: 'MEME', SHIB: 'MEME', PEPE: 'MEME', FLOKI: 'MEME', BONK: 'MEME', WIF: 'MEME',
};
function getCorrelationGroup(symbol: string): string {
  for (const [k, v] of Object.entries(CORR_GROUPS)) {
    if (symbol.startsWith(k)) return v;
  }
  return 'ALT';
}

function PositionDetailModal({ pos, ticker, onClose }: {
  pos: Position; ticker: Ticker | undefined; onClose: () => void;
}) {
  const isLong = pos.side === 'bid';
  const markPrice = getMarkPrice(ticker);
  const entry = Number(pos.entry_price || 0);
  const size = Number(pos.amount || 0);
  const posValue = size * markPrice;
  const pnl = Number(pos.unrealized_pnl || 0);
  const liqPrice = Number(pos.liquidation_price || 0);
  const leverage = pos.leverage
    ? Number(pos.leverage)
    : (pos.margin && posValue > 0 && Number(pos.margin) > 0)
      ? Math.round(posValue / Number(pos.margin))
      : null;
  const pnlPct = entry > 0 ? ((markPrice - entry) / entry * 100 * (isLong ? 1 : -1)) : 0;
  const distToLiq = liqPrice > 0 ? Math.abs(markPrice - liqPrice) / markPrice * 100 : null;
  const funding = Number(pos.funding || 0);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-border1 rounded-2xl shadow-card-md w-[400px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={`px-5 py-4 border-b border-border1 flex items-center justify-between ${isLong ? 'bg-success/5' : 'bg-danger/5'}`}>
          <div className="flex items-center gap-3">
            <CoinLogo symbol={pos.symbol} size={32} />
            <div>
              <div className="font-bold text-[14px] text-text1">{pos.symbol}-PERP</div>
              <div className={`text-[11px] font-semibold ${isLong ? 'text-success' : 'text-danger'}`}>
                {isLong ? '↑ LONG' : '↓ SHORT'}{leverage !== null ? ` · ${leverage}x` : ''}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-[20px] font-bold ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
              {pnl >= 0 ? '+' : ''}${fmt(pnl, 2)}
            </div>
            <div className={`text-[11px] font-semibold ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
              {pnlPct >= 0 ? '+' : ''}{fmt(pnlPct, 2)}%
            </div>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {[
            { label: 'Mark Price', value: '$' + fmtPrice(markPrice), color: 'text-text1' },
            { label: 'Entry Price', value: '$' + fmtPrice(entry), color: 'text-text3' },
            { label: 'Position Value', value: '$' + fmt(posValue, 2), color: 'text-accent' },
            { label: 'Size', value: fmt(size, 4) + ' ' + pos.symbol, color: 'text-text2' },
            { label: 'Liquidation Price', value: liqPrice > 0 ? '$' + fmtPrice(liqPrice) : '—', color: 'text-danger' },
            {
              label: 'Distance to Liq',
              value: distToLiq !== null ? fmt(distToLiq, 2) + '%' : '—',
              color: distToLiq !== null && distToLiq < 10 ? 'text-danger' : distToLiq !== null && distToLiq < 20 ? 'text-warn' : 'text-success',
            },
            { label: 'Funding Paid', value: (funding >= 0 ? '+' : '') + '$' + fmt(funding, 4), color: funding >= 0 ? 'text-success' : 'text-danger' },
            { label: 'Leverage', value: leverage !== null ? leverage + 'x' : '—', color: leverage !== null && leverage > 20 ? 'text-danger' : leverage !== null && leverage > 10 ? 'text-warn' : 'text-text2' },
          ].map(s => (
            <div key={s.label} className="bg-surface2 rounded-xl border border-border1 px-3 py-2.5">
              <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
              <div className={`text-[13px] font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
        {distToLiq !== null && distToLiq < 15 && (
          <div className="mx-4 mb-3 flex items-center gap-2 px-3 py-2 bg-danger/8 border border-danger/25 rounded-xl text-[11px] text-danger font-semibold">
            ⚡ Liquidation {fmt(distToLiq, 1)}% uzakta — pozisyonu küçültmeyi düşün
          </div>
        )}
        <div className="px-4 pb-4">
          <button onClick={onClose} className="w-full py-2.5 bg-surface2 border border-border1 rounded-xl text-[12px] font-semibold text-text2 hover:bg-surface transition-colors">
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

export function RiskManager({
  markets, tickers, fundingRates, positions, accountInfo,
  accountSize, onAccountSizeChange, wallet, error, onExecute,
}: RiskManagerProps) {
  const [activeTab, setActiveTab] = useState<RiskTab>('results');
  const [selected, setSelected] = useState<Market | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [winRate, setWinRate] = useState(50);
  const { entries: orderEntries } = useOrderLog(wallet);

  // Stable callbacks — prevent child re-renders on every ticker poll
  const handleSelectMarket = useCallback((m: Market) => {
    setSelected(m);
    setResult(null);
  }, []);
  const handleResult = useCallback((r: CalcResult | null) => setResult(r), []);
  const handleExecuteCalc = useCallback((r: CalcResult) => onExecute(r, selected?.symbol || ''), [onExecute, selected?.symbol]);
  const handleExecuteResult = useCallback((r: CalcResult) => onExecute(r, selected?.symbol || ''), [onExecute, selected?.symbol]);

  useEffect(() => {
    if (!selected && markets.length > 0) setSelected(markets[0]);
  }, [markets, selected]);

  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;
  const availableBalance = accountInfo ? Number(accountInfo.available_to_spend || 0) : Math.max(0, accountSize - totalMarginUsed);
  const portfolioRiskPct = equity > 0 ? Math.min((totalMarginUsed / equity) * 100, 100) : 0;

  const longPositions = positions.filter(p => p.side === 'bid');
  const shortPositions = positions.filter(p => p.side === 'ask');
  const totalLongValue = longPositions.reduce((s, p) => s + Number(p.amount || 0) * getMarkPrice(tickers[p.symbol]), 0);
  const totalShortValue = shortPositions.reduce((s, p) => s + Number(p.amount || 0) * getMarkPrice(tickers[p.symbol]), 0);
  const netExposure = totalLongValue - totalShortValue;
  const totalUnrealizedPnl = positions.reduce((s, p) => s + Number(p.unrealized_pnl || 0), 0);
  const totalFunding = positions.reduce((s, p) => s + Number(p.funding || 0), 0);
  const worstPnl = positions.length > 0 ? Math.min(...positions.map(p => Number(p.unrealized_pnl || 0))) : 0;
  const worstPositionLossPct = equity > 0 && worstPnl < 0 ? Math.abs(worstPnl / equity * 100) : 0;

  const groupCounts: Record<string, { count: number; side: string[] }> = {};
  positions.forEach(p => {
    const g = getCorrelationGroup(p.symbol);
    if (!groupCounts[g]) groupCounts[g] = { count: 0, side: [] };
    groupCounts[g].count++;
    groupCounts[g].side.push(p.side);
  });
  const correlatedGroups = Object.entries(groupCounts).filter(([, v]) => v.count >= 2);

  // Order log stats — memoized so they don't recompute on every ticker update
  const orderStats = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = now - 7 * 24 * 3600 * 1000;
    const todayEntries = orderEntries.filter(e => e.timestamp >= todayStart.getTime());
    const weekEntries = orderEntries.filter(e => e.timestamp >= weekStart);
    const successToday = todayEntries.filter(e => e.status === 'success').length;
    const successWeek = weekEntries.filter(e => e.status === 'success').length;
    const failedWeek = weekEntries.filter(e => e.status === 'failed').length;
    const winRateWeek = successWeek + failedWeek > 0 ? Math.round(successWeek / (successWeek + failedWeek) * 100) : null;
    return {
      totalAll: orderEntries.length,
      todayTotal: todayEntries.length,
      todaySuccess: successToday,
      weekTotal: weekEntries.length,
      weekSuccess: successWeek,
      weekFailed: failedWeek,
      winRateWeek,
      recentEntries: orderEntries.slice(0, 8),
    };
  }, [orderEntries]);

  const PANEL_H = 'calc(100vh - 15rem)';

  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="w-full max-w-[1400px] mx-auto px-6 pt-5">

        {/* Single card wrapping StatsBar + 3-col grid */}
        <div className="border border-border1 rounded-2xl overflow-hidden shadow-card bg-surface mt-5 mb-6">

          <StatsBar
            accountInfo={accountInfo}
            positions={positions}
            accountSize={accountSize}
            availableBalance={availableBalance}
          />

          {/* Main 3-column grid */}
          <div
            className="grid border-t border-border1"
            style={{ gridTemplateColumns: '220px 1fr 340px' }}
          >
          {/* LEFT: Market List */}
          <div className="border-r border-border1 overflow-hidden flex flex-col" style={{ height: PANEL_H, minHeight: 500 }}>
            <MarketList
              markets={markets}
              tickers={tickers}
              fundingRates={fundingRates}
              selected={selected}
              onSelect={handleSelectMarket}
              error={error}
            />
          </div>

          {/* CENTER: Calculator */}
          <div className="border-r border-border1 overflow-hidden flex flex-col" style={{ height: PANEL_H, minHeight: 500 }}>
            <Calculator
              market={selected}
              ticker={selected ? tickers[selected.symbol] : undefined}
              funding={selected ? fundingRates[selected.symbol] : undefined}
              accountSize={accountSize}
              onAccountSizeChange={onAccountSizeChange}
              onResult={handleResult}
              onExecute={handleExecuteCalc}
              walletConnected={!!wallet}
            />
          </div>

          {/* RIGHT: Results / Portfolio */}
          <div className="overflow-hidden flex flex-col" style={{ height: PANEL_H, minHeight: 500 }}>
            <div className="flex border-b border-border1 bg-surface shrink-0 px-2">
              {([{ key: 'results', label: 'Results' }, { key: 'portfolio', label: 'Portfolio' }] as { key: RiskTab; label: string }[]).map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-all whitespace-nowrap ${activeTab === t.key ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2'}`}>
                  {t.label}
                  {t.key === 'portfolio' && positions.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] bg-accent/15 text-accent font-bold">{positions.length}</span>
                  )}
                </button>
              ))}
            </div>

            {activeTab === 'results' && (
              <div className="flex-1 overflow-hidden">
                <Results
                  result={result}
                  accountInfo={accountInfo}
                  accountSize={accountSize}
                  onExecute={handleExecuteResult}
                  walletConnected={!!wallet}
                  market={selected?.symbol || ''}
                  winRate={winRate}
                  onWinRateChange={setWinRate}
                />
              </div>
            )}

            {activeTab === 'portfolio' && (
              <div className="flex-1 overflow-auto p-4 bg-bg space-y-4">

                {/* 4-stat summary */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: 'Portfolio Risk',
                      value: fmt(portfolioRiskPct, 1) + '%',
                      sub: `Margin $${fmt(totalMarginUsed, 0)} / equity`,
                      color: portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger',
                    },
                    {
                      label: 'Unrealized PnL',
                      value: (totalUnrealizedPnl >= 0 ? '+' : '') + '$' + fmt(totalUnrealizedPnl, 2),
                      sub: `Funding: ${totalFunding >= 0 ? '+' : ''}$${fmt(totalFunding, 2)}`,
                      color: totalUnrealizedPnl >= 0 ? 'text-success' : 'text-danger',
                    },
                    {
                      label: 'Net Exposure',
                      value: (netExposure >= 0 ? 'Long ' : 'Short ') + '$' + fmt(Math.abs(netExposure), 0),
                      sub: `L $${fmt(totalLongValue, 0)} · S $${fmt(totalShortValue, 0)}`,
                      color: Math.abs(netExposure) < 1000 ? 'text-success' : 'text-warn',
                    },
                    {
                      label: 'Positions',
                      value: String(positions.length),
                      sub: `${longPositions.length} long · ${shortPositions.length} short`,
                      color: positions.length > 0 ? 'text-accent' : 'text-text3',
                    },
                  ].map(s => (
                    <div key={s.label} className="bg-surface rounded-xl border border-border1 p-3 shadow-card">
                      <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1.5">{s.label}</div>
                      <div className={`text-[17px] font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-[10px] text-text3 mt-0.5">{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Risk exposure bar */}
                <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[12px] font-semibold text-text2">Risk Exposure</span>
                    <div className="flex items-center gap-3">
                      {worstPositionLossPct > 0 && (
                        <span className="text-[10px] text-text3">
                          Worst position: <span className="text-danger font-semibold">-{fmt(worstPositionLossPct, 1)}%</span>
                        </span>
                      )}
                      <span className={`text-[15px] font-bold ${portfolioRiskPct < 10 ? 'text-success' : portfolioRiskPct < 25 ? 'text-warn' : 'text-danger'}`}>
                        {fmt(portfolioRiskPct, 1)}%
                      </span>
                    </div>
                  </div>
                  <div className="relative h-3 bg-gradient-to-r from-success via-warn to-danger rounded-full">
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-text2 rounded-full shadow-md transition-all"
                      style={{ left: `calc(${Math.min(portfolioRiskPct * 2, 96)}% - 8px)` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-text3 mt-1.5">
                    <span className="text-success font-semibold">Safe &lt;10%</span>
                    <span className="text-warn font-semibold">Moderate 10-25%</span>
                    <span className="text-danger font-semibold">High &gt;25%</span>
                  </div>
                </div>

                {/* Correlation warnings */}
                {correlatedGroups.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold text-text3 uppercase tracking-wide">Korelasyon Uyarıları</div>
                    {correlatedGroups.map(([group, data]) => {
                      const allSameSide = data.side.every(s => s === data.side[0]);
                      return (
                        <div key={group} className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[11px] ${allSameSide ? 'bg-warn/8 border-warn/25 text-warn' : 'bg-accent/8 border-accent/25 text-accent'}`}>
                          <span className="shrink-0 mt-0.5">{allSameSide ? '⚠' : 'ℹ'}</span>
                          <span>
                            <span className="font-bold">{data.count} {group} pozisyon</span>
                            {allSameSide
                              ? ` — tümü ${data.side[0] === 'bid' ? 'LONG' : 'SHORT'}, yüksek korelasyon riski`
                              : ' — karışık yön, kısmen hedge edilmiş'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Position bubbles */}
                {positions.length > 0 ? (
                  <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[12px] font-semibold text-text2">Position Heat Map</div>
                      <div className="text-[10px] text-text3 bg-accent/10 text-accent px-2 py-0.5 rounded-full font-semibold">tıkla → detay</div>
                    </div>
                    <div className="text-[10px] text-text3 mb-4">Boyut = pozisyon değeri · Renk = PnL</div>
                    <div className="flex flex-wrap gap-3 justify-center">
                      {positions.map(p => {
                        const tk = tickers[p.symbol];
                        const size = Number(p.amount || 0) * getMarkPrice(tk);
                        const pnl = Number(p.unrealized_pnl || 0);
                        const maxSize = Math.max(...positions.map(pos => Number(pos.amount || 0) * getMarkPrice(tickers[pos.symbol])), 1);
                        const relSize = size / maxSize;
                        const isLong = p.side === 'bid';
                        const diameter = Math.max(56, relSize * 110);
                        const pnlIntensity = Math.min(Math.abs(pnl) / (size * 0.05 || 1), 1);
                        const bubbleBg = pnl > 0
                          ? `rgba(16,185,129,${0.1 + pnlIntensity * 0.35})`
                          : pnl < 0
                            ? `rgba(239,68,68,${0.1 + pnlIntensity * 0.35})`
                            : isLong ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
                        const borderColor = pnl > 0 ? '#10b981' : pnl < 0 ? '#ef4444' : isLong ? '#10b981' : '#ef4444';
                        const liqPriceN = Number(p.liquidation_price || 0);
                        const markP = getMarkPrice(tk);
                        const distToLiq = liqPriceN > 0 ? Math.abs(markP - liqPriceN) / markP * 100 : null;

                        return (
                          <div key={p.symbol} className="flex flex-col items-center gap-1">
                            <div
                              onClick={() => setSelectedPosition(p)}
                              className="rounded-full flex flex-col items-center justify-center border-2 transition-all hover:scale-105 cursor-pointer hover:ring-2 hover:ring-accent/40"
                              style={{ width: diameter, height: diameter, background: bubbleBg, borderColor }}
                            >
                              <CoinLogo symbol={p.symbol} size={Math.max(16, diameter * 0.28)} />
                              <span className="text-[9px] font-bold text-text1 mt-0.5">{p.symbol}</span>
                              {pnl !== 0 && (
                                <span className={`text-[8px] font-bold ${pnl > 0 ? 'text-success' : 'text-danger'}`}>
                                  {pnl > 0 ? '+' : ''}${fmt(pnl, 1)}
                                </span>
                              )}
                              {distToLiq !== null && distToLiq < 15 && (
                                <span className="text-[7px] text-danger font-bold">⚡{fmt(distToLiq, 0)}%</span>
                              )}
                            </div>
                            <span className={`text-[10px] font-bold ${isLong ? 'text-success' : 'text-danger'}`}>
                              {isLong ? '↑ L' : '↓ S'}
                            </span>
                            <span className="text-[10px] text-text3 font-mono">${fmt(size, 0)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-surface rounded-xl border border-dashed border-border2 p-10 text-center">
                    <div className="text-3xl mb-2 opacity-30">◉</div>
                    <p className="text-sm font-semibold text-text2">Açık pozisyon yok</p>
                    <p className="text-xs mt-1 text-text3">Pozisyonlar burada baloncuk olarak görünür</p>
                    <p className="text-xs mt-0.5 text-text3">Boyut = değer · Renk = PnL · Tıkla = detay</p>
                  </div>
                )}

                {/* L/S breakdown */}
                {positions.length > 0 && (
                  <div className="bg-surface rounded-xl border border-border1 p-4 shadow-card">
                    <div className="text-[12px] font-semibold text-text2 mb-3">Long / Short Breakdown</div>
                    <div className="space-y-2">
                      <div className="flex h-3 rounded-full overflow-hidden bg-surface2">
                        {totalLongValue + totalShortValue > 0 && (
                          <>
                            <div className="bg-success/70 transition-all" style={{ width: `${(totalLongValue / (totalLongValue + totalShortValue)) * 100}%` }} />
                            <div className="bg-danger/70 flex-1 transition-all" />
                          </>
                        )}
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success/70 inline-block" />Long <span className="font-bold text-success">${fmt(totalLongValue, 0)}</span></span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger/70 inline-block" />Short <span className="font-bold text-danger">${fmt(totalShortValue, 0)}</span></span>
                      </div>
                      <div className={`text-center text-[12px] font-bold ${Math.abs(netExposure) < 500 ? 'text-success' : 'text-warn'}`}>
                        Net: {netExposure >= 0 ? 'Long' : 'Short'} ${fmt(Math.abs(netExposure), 0)}
                        {Math.abs(netExposure) < 500 && <span className="text-[10px] text-success ml-2">✓ Neredeyse hedge</span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Trade History Summary */}
                <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border1 bg-surface2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text2">Trade Geçmişi</span>
                    <span className="text-[10px] text-text3">{orderStats.totalAll} toplam emir</span>
                  </div>
                  {orderStats.totalAll === 0 ? (
                    <div className="px-4 py-6 text-center text-text3 text-[11px]">Henüz emir yok — bir trade aç</div>
                  ) : (
                    <>
                      {/* Stats row */}
                      <div className="grid grid-cols-3 divide-x divide-border1 border-b border-border1">
                        {[
                          { label: 'Bugün', value: String(orderStats.todayTotal), sub: `${orderStats.todaySuccess} başarılı` },
                          { label: 'Bu Hafta', value: String(orderStats.weekTotal), sub: `${orderStats.weekSuccess}W · ${orderStats.weekFailed}F` },
                          { label: 'Win Rate', value: orderStats.winRateWeek !== null ? `${orderStats.winRateWeek}%` : '—', sub: '7 günlük', color: orderStats.winRateWeek !== null ? (orderStats.winRateWeek >= 50 ? 'text-success' : 'text-danger') : 'text-text3' },
                        ].map(s => (
                          <div key={s.label} className="px-3 py-2.5 text-center">
                            <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-1">{s.label}</div>
                            <div className={`text-[15px] font-bold ${s.color || 'text-text1'}`}>{s.value}</div>
                            <div className="text-[9px] text-text3 mt-0.5">{s.sub}</div>
                          </div>
                        ))}
                      </div>

                      {/* Recent entries */}
                      <div className="divide-y divide-border1">
                        {orderStats.recentEntries.map(e => {
                          const isLong = e.side === 'bid';
                          const d = new Date(e.timestamp);
                          const timeStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                          const dateStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
                          return (
                            <div key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface2/50 transition-colors">
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                                {isLong ? '↑ L' : '↓ S'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-semibold text-text1">{e.symbol}</div>
                                <div className="text-[9px] text-text3">{e.amount} @ ${e.price}</div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className={`text-[10px] font-semibold ${e.status === 'success' ? 'text-success' : e.status === 'failed' ? 'text-danger' : e.status === 'pending' ? 'text-warn' : 'text-text3'}`}>
                                  {e.status === 'success' ? '✓' : e.status === 'failed' ? '✗' : e.status === 'pending' ? '⏳' : '—'}
                                </div>
                                <div className="text-[9px] text-text3">{dateStr} {timeStr}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>

      {selectedPosition && (
        <PositionDetailModal
          pos={selectedPosition}
          ticker={tickers[selectedPosition.symbol]}
          onClose={() => setSelectedPosition(null)}
        />
      )}
    </div>
  </div>
  );
}