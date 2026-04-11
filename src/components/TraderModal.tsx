'use client';

import { useState, useEffect } from 'react';
import {
  Position, Ticker, TradeHistory, AccountInfo,
  getPositions, getTradeHistory, getAccountInfo
} from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice, getMarkPrice, fmtShortAddr } from '@/lib/utils';
import { CalcResult } from './Calculator';
import { Market } from '@/lib/pacifica';

interface TraderModalProps {
  walletAddress: string;
  myWallet: string | null;
  myAccountInfo: AccountInfo | null;
  tickers: Record<string, Ticker>;
  markets: Market[];
  onExecute: (r: CalcResult, symbol: string) => void;
  onClose: () => void;
}

function fmtN(n: number) {
  if (n >= 1e9) return '$' + fmt(n / 1e9, 2) + 'B';
  if (n >= 1e6) return '$' + fmt(n / 1e6, 2) + 'M';
  if (n >= 1e3) return '$' + fmt(n / 1e3, 1) + 'K';
  return '$' + fmt(n, 2);
}

// Copy Trade sub-modal
function CopyModal({
  pos, myBalance, myWallet, market, tickers, onExecute, onClose
}: {
  pos: Position;
  myBalance: number;
  myWallet: string | null;
  market: Market | undefined;
  tickers: Record<string, Ticker>;
  onExecute: (r: CalcResult, symbol: string) => void;
  onClose: () => void;
}) {
  const tk = tickers[pos.symbol];
  const markPrice = getMarkPrice(tk);
  const isLong = pos.side === 'bid';
  const side: 'long' | 'short' = isLong ? 'long' : 'short';

  // Auto-fill from copied position
  const traderEntry = Number(pos.entry_price || markPrice);
  const traderMargin = Number(pos.margin || 0);
  const traderLeverage = pos.leverage ? Number(pos.leverage) : 
    traderMargin > 0 ? Math.round((Number(pos.amount) * traderEntry) / traderMargin) : 10;
  const clampedLeverage = Math.max(1, Math.min(traderLeverage, market?.max_leverage || 50));

  const [usdcAmount, setUsdcAmount] = useState(Math.max(10, Math.min(100, myBalance)));
  const [leverage, setLeverage] = useState(clampedLeverage);
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState(String(traderEntry));
  const [placing, setPlacing] = useState(false);

  const maxLev = market?.max_leverage || 50;
  const entryPrice = orderType === 'market' ? markPrice : (Number(limitPrice) || markPrice);
  // Deduct taker fee (0.04%) + builder fee (0.01%) from effective margin
  const TOTAL_FEE_RATE = 0.0004 + 0.001; // taker 0.04% + builder 0.1%
  const estimatedFee = usdcAmount * leverage * TOTAL_FEE_RATE;
  const effectiveMargin = Math.max(0, usdcAmount - estimatedFee);
  const positionValue = effectiveMargin * leverage;
  const contracts = entryPrice > 0 ? positionValue / entryPrice : 0;
  const liqPrice = side === 'long'
    ? entryPrice * (1 - 0.9 / leverage)
    : entryPrice * (1 + 0.9 / leverage);

  const presets = [50, 100, 250, 500, 1000].filter(p => p <= myBalance * 1.1);

  async function handleCopy() {
    if (!myWallet) return;
    setPlacing(true);
    const r: CalcResult = {
      riskAmount: effectiveMargin,
      positionSize: contracts,
      positionValue,
      requiredMargin: effectiveMargin,
      marginPct: 0,
      slPct: 0,
      liquidationPrice: liqPrice,
      tp1: 0,
      tp2: 0,
      tp3: 0,
      rrRatio: 0,
      fundingCostDaily: 0,
      fundingCostWeekly: 0,
      breakEvenPrice: entryPrice,
      side,
      leverage,
      entryPrice,
      stopLoss: liqPrice,
    };
    await onExecute(r, pos.symbol);
    setPlacing(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-border1 rounded-2xl shadow-card-md w-[460px] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={'px-6 py-4 border-b border-border1 flex items-center justify-between ' + (isLong ? 'bg-success/6' : 'bg-danger/6')}>
          <div className="flex items-center gap-3">
            <CoinLogo symbol={pos.symbol} size={36} />
            <div>
              <div className="text-[15px] font-bold text-text1">Copy Trade · {pos.symbol}-PERP</div>
              <div className={'text-[11px] font-semibold ' + (isLong ? 'text-success' : 'text-danger')}>
                {isLong ? '↑ LONG' : '↓ SHORT'} · ${fmtPrice(markPrice)}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface2 text-text3 text-xl">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Wallet balance */}
          {myBalance > 0 && (
            <div className="flex items-center justify-between bg-accent/5 border border-accent/20 rounded-xl px-4 py-2.5">
              <span className="text-[11px] text-text2">My Balance</span>
              <span className="text-[14px] font-bold text-accent">${fmt(myBalance, 2)} USDC</span>
            </div>
          )}

          {/* Trader's original position info */}
          <div className="bg-surface2 border border-border1 rounded-xl px-4 py-3 space-y-1">
            <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-2">Trader's Original Position</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { l: 'Entry', v: '$' + fmtPrice(traderEntry) },
                { l: 'Leverage', v: clampedLeverage + 'x' },
                { l: 'Margin', v: traderMargin > 0 ? fmtN(traderMargin) : '—' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-[9px] text-text3 uppercase font-semibold">{s.l}</div>
                  <div className="text-[12px] font-bold text-text1">{s.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Order type */}
          <div className="flex bg-surface2 border border-border1 rounded-xl overflow-hidden">
            {(['market', 'limit'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                className={'flex-1 py-2 text-[12px] font-semibold capitalize transition-all ' +
                  (orderType === t ? 'bg-surface text-text1 shadow-sm' : 'text-text3 hover:text-text2')}>
                {t}
              </button>
            ))}
          </div>

          {orderType === 'limit' && (
            <div>
              <label className="text-[10px] text-text3 uppercase font-semibold block mb-1.5">Limit Price (USD)</label>
              <div className="relative">
                <input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  className="w-full bg-surface2 border border-border1 rounded-xl px-3 py-2.5 text-[13px] font-mono text-text1 outline-none focus:border-accent" />
                <button onClick={() => setLimitPrice(String(markPrice))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-accent hover:underline font-semibold">
                  Mark
                </button>
              </div>
            </div>
          )}

          {/* USDC Amount */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="text-[10px] text-text3 uppercase font-semibold">Margin (USDC)</label>
              <span className="relative inline-flex items-center group">
                <span className="w-3.5 h-3.5 rounded-full border border-border2 text-text3 flex items-center justify-center text-[8px] font-bold cursor-help select-none">?</span>
                <span className="absolute bottom-full right-0 mb-2 w-56 bg-surface border border-border1 rounded-lg px-2.5 py-2 text-[10px] text-text2 leading-relaxed shadow-lg z-[300] pointer-events-none whitespace-normal hidden group-hover:block">
                  Minimum is $10. Your collateral in USDC — position size = Margin × Leverage. We recommend at least $10.50 per trade.
                </span>
              </span>
            </div>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {presets.map(p => (
                <button key={p} onClick={() => setUsdcAmount(p)}
                  className={'px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-all ' +
                    (usdcAmount === p ? 'bg-accent text-white border-accent' : 'bg-surface2 border-border1 text-text3 hover:border-accent hover:text-accent')}>
                  ${p}
                </button>
              ))}
            </div>
            <input type="number" value={usdcAmount} onChange={e => setUsdcAmount(Number(e.target.value))}
              className={`w-full bg-surface2 border rounded-xl px-3 py-2.5 text-[13px] font-mono text-text1 outline-none focus:border-accent ${usdcAmount < 10 ? 'border-danger/60' : 'border-border1'}`} />
            {usdcAmount < 10 && (
              <p className="text-[9px] text-danger mt-1">Minimum $10 required. We recommend at least $10.50 per trade.</p>
            )}
          </div>

          {/* Leverage */}
          <div>
            <div className="flex justify-between mb-1.5">
              <label className="text-[10px] text-text3 uppercase font-semibold">Leverage</label>
              <span className={'text-[12px] font-bold ' + (leverage > maxLev * 0.7 ? 'text-danger' : 'text-accent')}>{leverage}x</span>
            </div>
            <input type="range" min={1} max={maxLev} value={leverage}
              onChange={e => setLeverage(Number(e.target.value))} className="w-full" />
            <div className="flex justify-between text-[9px] text-text3 mt-1">
              <span>1x</span>
              {[Math.round(maxLev/4), Math.round(maxLev/2), Math.round(maxLev*3/4)].map(v => (
                <button key={v} onClick={() => setLeverage(v)} className="hover:text-accent transition-colors">{v}x</button>
              ))}
              <span className={leverage >= maxLev ? 'text-danger font-bold' : ''}>{maxLev}x</span>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-surface2 border border-border1 rounded-xl p-3.5 space-y-2">
            {[
              { l: 'Position Value', v: '$' + fmt(positionValue, 2) },
              { l: 'Contracts', v: fmt(contracts, 4) + ' ' + pos.symbol },
              { l: 'Est. Liq. Price', v: '$' + fmtPrice(liqPrice), c: 'text-danger' },
              { l: 'Entry Price', v: orderType === 'market' ? 'Market (~$' + fmtPrice(markPrice) + ')' : '$' + fmtPrice(Number(limitPrice)) },
            ].map(row => (
              <div key={row.l} className="flex justify-between">
                <span className="text-[11px] text-text3">{row.l}</span>
                <span className={'text-[12px] font-semibold ' + (row.c || 'text-text1')}>{row.v}</span>
              </div>
            ))}
          </div>

          {/* Execute */}
          <button onClick={handleCopy} disabled={!myWallet || placing || usdcAmount <= 0 || usdcAmount < 10}
            className={'w-full py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-40 ' +
              (isLong ? 'bg-success text-white hover:opacity-90' : 'bg-danger text-white hover:opacity-90')}>
            {placing ? 'Opening Position...' : !myWallet ? 'Connect Wallet' :
              `Copy ${isLong ? 'Long' : 'Short'} ${pos.symbol} · $${usdcAmount} ${leverage}x`}
          </button>
          <p className="text-[10px] text-text3 text-center">Position will be opened on Pacifica DEX</p>
        </div>
      </div>
    </div>
  );
}

// Main Trader Modal
export function TraderModal({ walletAddress, myWallet, myAccountInfo, tickers, markets, onExecute, onClose }: TraderModalProps) {
  const [tab, setTab] = useState<'positions' | 'history'>('positions');
  const [positions, setPositions] = useState<Position[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([]);
  const [traderAccount, setTraderAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyPos, setCopyPos] = useState<Position | null>(null);

  const myBalance = myAccountInfo
    ? Number(myAccountInfo.available_to_spend || myAccountInfo.account_equity || 0)
    : 0;

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [pos, acc] = await Promise.all([
        getPositions(walletAddress),
        getAccountInfo(walletAddress),
      ]);
      setPositions(pos);
      setTraderAccount(acc);
      setLoading(false);
    }
    load();
  }, [walletAddress]);

  useEffect(() => {
    if (tab === 'history' && tradeHistory.length === 0) {
      getTradeHistory(walletAddress, 50).then(setTradeHistory);
    }
  }, [tab, walletAddress, tradeHistory.length]);

  // Calculate trader stats
  const totalUnrealizedPnl = positions.reduce((s, p) => {
    const tk = tickers[p.symbol];
    const mark = getMarkPrice(tk);
    const entry = Number(p.entry_price || 0);
    const size = Number(p.amount || 0);
    const isLong = p.side === 'bid';
    return s + (isLong ? (mark - entry) * size : (entry - mark) * size);
  }, 0);

  const totalMargin = positions.reduce((s, p) => s + Number(p.margin || 0), 0);
  const winTrades = tradeHistory.filter(t => Number(t.realized_pnl || 0) > 0).length;
  const winRate = tradeHistory.length > 0 ? Math.round((winTrades / tradeHistory.length) * 100) : 0;
  const totalPnl = tradeHistory.reduce((s, t) => s + Number(t.realized_pnl || 0), 0);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-surface border border-border1 rounded-2xl shadow-card-md w-[680px] max-h-[88vh] flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="px-6 py-4 border-b border-border1 bg-surface2 flex items-center justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-[14px]">
                  {walletAddress.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-[15px] font-bold text-text1 font-mono">{fmtShortAddr(walletAddress)}</div>
                  <div className="text-[10px] text-text3 mt-0.5">{walletAddress}</div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Trader stats */}
              {!loading && traderAccount && (
                <div className="flex gap-3 text-right">
                  <div>
                    <div className="text-[9px] text-text3 uppercase font-semibold">Equity</div>
                    <div className="text-[13px] font-bold text-text1">${fmt(Number(traderAccount.account_equity || 0), 2)}</div>
                  </div>
                  {tradeHistory.length > 0 && (
                    <>
                      <div>
                        <div className="text-[9px] text-text3 uppercase font-semibold">Win Rate</div>
                        <div className={'text-[13px] font-bold ' + (winRate >= 50 ? 'text-success' : 'text-danger')}>{winRate}%</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-text3 uppercase font-semibold">Total PnL</div>
                        <div className={'text-[13px] font-bold ' + (totalPnl >= 0 ? 'text-success' : 'text-danger')}>
                          {totalPnl >= 0 ? '+' : ''}${fmt(totalPnl, 2)}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface2 text-text3 text-xl ml-2">×</button>
            </div>
          </div>

          {/* Summary bar */}
          {!loading && positions.length > 0 && (
            <div className="px-6 py-3 border-b border-border1 bg-surface flex items-center gap-6 shrink-0 text-[11px]">
              <span className="text-text3">
                <span className="font-semibold text-accent">{positions.length}</span> open positions
              </span>
              <span className="text-text3">
                Unrealized PnL: <span className={'font-bold ' + (totalUnrealizedPnl >= 0 ? 'text-success' : 'text-danger')}>
                  {totalUnrealizedPnl >= 0 ? '+' : ''}${fmt(totalUnrealizedPnl, 2)}
                </span>
              </span>
              {totalMargin > 0 && (
                <span className="text-text3">Margin: <span className="font-semibold text-warn">${fmt(totalMargin, 2)}</span></span>
              )}
              {myBalance > 0 && (
                <span className="ml-auto text-text3">My balance: <span className="font-bold text-accent">${fmt(myBalance, 2)}</span></span>
              )}
            </div>
          )}

          {/* Tab bar */}
          <div className="flex border-b border-border1 bg-surface shrink-0">
            <button onClick={() => setTab('positions')}
              className={'px-5 py-2.5 text-[11px] font-semibold border-b-2 transition-all flex items-center gap-1.5 ' +
                (tab === 'positions' ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}>
              Open Positions
              {positions.length > 0 && (
                <span className={'text-[9px] px-1.5 py-0.5 rounded-full font-bold ' + (tab === 'positions' ? 'bg-accent/15 text-accent' : 'bg-surface2 text-text3')}>
                  {positions.length}
                </span>
              )}
            </button>
            <button onClick={() => setTab('history')}
              className={'px-5 py-2.5 text-[11px] font-semibold border-b-2 transition-all ' +
                (tab === 'history' ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}>
              Trade History
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-text3">
                <div className="w-5 h-5 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-sm">Loading trader data...</span>
              </div>
            ) : tab === 'positions' ? (
              positions.length > 0 ? (
                <div className="divide-y divide-border1">
                  {positions.map((p, i) => {
                    const tk = tickers[p.symbol];
                    const mark = getMarkPrice(tk);
                    const entry = Number(p.entry_price || 0);
                    const size = Number(p.amount || 0);
                    const margin = Number(p.margin || 0);
                    const isLong = p.side === 'bid';
                    const pnl = isLong ? (mark - entry) * size : (entry - mark) * size;
                    const pnlPct = margin > 0 ? (pnl / margin) * 100 : 0;
                    const posValue = size * mark;
                    const leverage = p.leverage ? Number(p.leverage) : (margin > 0 ? Math.round(posValue / margin) : '?');
                    const liqPrice = p.liquidation_price ? Number(p.liquidation_price) :
                      (typeof leverage === 'number' && leverage > 0
                        ? isLong ? entry * (1 - 0.9 / leverage) : entry * (1 + 0.9 / leverage)
                        : 0);
                    const market = markets.find(m => m.symbol === p.symbol);

                    return (
                      <div key={i} className="px-5 py-4 hover:bg-surface2/30 transition-colors">
                        {/* Position header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <CoinLogo symbol={p.symbol} size={32} />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-text1 text-[14px]">{p.symbol}-PERP</span>
                                <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
                                  {isLong ? '↑ LONG' : '↓ SHORT'}
                                </span>
                                {leverage !== '?' && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                                    {leverage}x
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-text3 mt-0.5">
                                {fmt(size, 4)} contracts · ${fmtPrice(posValue)} value
                              </div>
                            </div>
                          </div>
                          {/* PnL */}
                          <div className="text-right">
                            <div className={'text-[18px] font-bold ' + (pnl >= 0 ? 'text-success' : 'text-danger')}>
                              {pnl !== 0 ? (pnl >= 0 ? '+' : '') + '$' + fmt(pnl, 2) : '—'}
                            </div>
                            {pnlPct !== 0 && (
                              <div className={'text-[11px] font-semibold ' + (pnlPct >= 0 ? 'text-success' : 'text-danger')}>
                                {pnlPct >= 0 ? '+' : ''}{fmt(pnlPct, 2)}%
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Position details grid */}
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          {[
                            { l: 'Entry Price', v: '$' + fmtPrice(entry) },
                            { l: 'Mark Price', v: '$' + fmtPrice(mark) },
                            { l: 'Liq. Price', v: liqPrice > 0 ? '$' + fmtPrice(liqPrice) : '—', c: 'text-danger' },
                            { l: 'Margin', v: margin > 0 ? '$' + fmt(margin, 2) : '—' },
                          ].map(f => (
                            <div key={f.l} className="bg-surface2 rounded-xl p-2.5 border border-border1">
                              <div className="text-[9px] text-text3 uppercase font-semibold tracking-wide mb-0.5">{f.l}</div>
                              <div className={'text-[12px] font-bold ' + (f.c || 'text-text1')}>{f.v}</div>
                            </div>
                          ))}
                        </div>

                        {/* Copy trade button */}
                        <button
                          onClick={() => setCopyPos(p)}
                          className={'w-full py-2.5 rounded-xl text-[12px] font-bold border transition-all ' +
                            (isLong
                              ? 'border-success/30 text-success hover:bg-success/10'
                              : 'border-danger/30 text-danger hover:bg-danger/10')}>
                          Copy This {isLong ? 'Long' : 'Short'} Position →
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-text3 gap-3">
                  <div className="text-4xl">◎</div>
                  <p className="font-semibold text-text2">No open positions</p>
                  <p className="text-sm">This trader has no active positions</p>
                </div>
              )
            ) : (
              /* Trade History */
              <div className="overflow-x-auto">
                {tradeHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-text3 gap-2">
                    <div className="w-5 h-5 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                    <span className="text-sm">Loading history...</span>
                  </div>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-surface2 border-b border-border1">
                      <tr>
                        <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-left">Time</th>
                        <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-left">Market</th>
                        <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-left">Side</th>
                        <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-right">Price</th>
                        <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-right">Size</th>
                        <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-right">Realized PnL</th>
                        <th className="px-4 py-2.5 text-[10px] text-text3 font-semibold uppercase text-right">Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeHistory.map((t, i) => {
                        const pnl = Number(t.realized_pnl || 0);
                        const isLong = t.side.includes('long');
                        const isOpen = t.side.startsWith('open');
                        return (
                          <tr key={i} className="border-b border-border1 hover:bg-surface2/40">
                            <td className="px-4 py-2.5 text-text3">
                              {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <CoinLogo symbol={t.symbol} size={16} />
                                <span className="font-semibold text-text1">{t.symbol}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' +
                                (isLong && isOpen ? 'bg-success/10 text-success' : !isLong && isOpen ? 'bg-danger/10 text-danger' : 'bg-surface2 text-text3')}>
                                {t.side.replace('_', ' ').toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-text2">${fmtPrice(Number(t.price))}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-text2">{fmt(Number(t.amount), 4)}</td>
                            <td className={'px-4 py-2.5 text-right font-mono font-bold ' + (pnl >= 0 ? 'text-success' : 'text-danger')}>
                              {pnl !== 0 ? (pnl >= 0 ? '+' : '') + '$' + fmt(pnl, 2) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-warn text-[10px]">
                              {Number(t.fee || 0) > 0 ? '$' + fmt(Number(t.fee), 4) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Copy Modal */}
      {copyPos && (
        <CopyModal
          pos={copyPos}
          myBalance={myBalance}
          myWallet={myWallet}
          market={markets.find(m => m.symbol === copyPos.symbol)}
          tickers={tickers}
          onExecute={onExecute}
          onClose={() => setCopyPos(null)}
        />
      )}
    </>
  );
}
