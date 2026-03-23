'use client';

import { useState, useEffect, useRef } from 'react';
import { Market, Ticker, getOrderbook, Orderbook } from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice, getMarkPrice, get24hChange } from '@/lib/utils';
import { CalcResult } from './Calculator';

interface TradingPanelProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  wallet: string | null;
  onExecute: (r: CalcResult, symbol: string) => void;
}

function OrderbookPanel({ orderbook, markPrice }: { orderbook: Orderbook | null; markPrice: number }) {
  if (!orderbook) return (
    <div className="flex items-center justify-center h-full text-text3 text-sm">Loading...</div>
  );
  const maxAsk = Math.max(...orderbook.asks.slice(0, 15).map(l => Number(l.a)), 1);
  const maxBid = Math.max(...orderbook.bids.slice(0, 15).map(l => Number(l.a)), 1);
  return (
    <div className="flex flex-col h-full text-[11px] overflow-hidden">
      <div className="grid px-3 py-1 border-b border-border1 bg-surface2 text-[10px] text-text3 font-semibold uppercase shrink-0"
        style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <span>Price</span><span className="text-right">Size</span><span className="text-right">Total</span>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col-reverse">
        {orderbook.asks.slice(0, 15).map((l, i) => (
          <div key={i} className="relative grid px-3 py-0.5 hover:bg-danger/5"
            style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="absolute inset-y-0 right-0 bg-danger/8"
              style={{ width: (Number(l.a) / maxAsk * 100) + '%' }} />
            <span className="text-danger font-mono relative">${fmtPrice(l.p)}</span>
            <span className="text-right font-mono relative text-text2">{fmt(Number(l.a), 4)}</span>
            <span className="text-right font-mono relative text-text3">{fmt(Number(l.a) * Number(l.p), 0)}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 border-y border-border1 bg-surface2 flex justify-between shrink-0">
        <span className="text-[13px] font-bold">${fmtPrice(markPrice)}</span>
        <span className="text-[10px] text-text3">
          Spread: {orderbook.asks[0] && orderbook.bids[0]
            ? fmtPrice(Number(orderbook.asks[0].p) - Number(orderbook.bids[0].p)) : '—'}
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        {orderbook.bids.slice(0, 15).map((l, i) => (
          <div key={i} className="relative grid px-3 py-0.5 hover:bg-success/5"
            style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="absolute inset-y-0 right-0 bg-success/8"
              style={{ width: (Number(l.a) / maxBid * 100) + '%' }} />
            <span className="text-success font-mono relative">${fmtPrice(l.p)}</span>
            <span className="text-right font-mono relative text-text2">{fmt(Number(l.a), 4)}</span>
            <span className="text-right font-mono relative text-text3">{fmt(Number(l.a) * Number(l.p), 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TradingPanel({ markets, tickers, wallet, onExecute }: TradingPanelProps) {
  const [selected, setSelected] = useState<Market | null>(null);
  const [search, setSearch] = useState('');
  const [rightTab, setRightTab] = useState<'orderbook' | 'trade'>('trade');
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tpEnabled, setTpEnabled] = useState(false);
  const [slEnabled, setSlEnabled] = useState(false);
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [placing, setPlacing] = useState(false);
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const tk = selected ? tickers[selected.symbol] : null;
  const markPrice = getMarkPrice(tk ?? undefined);
  const change24h = get24hChange(tk ?? undefined);
  const volume24h = Number(tk?.volume_24h || 0);
  const oi = Number(tk?.open_interest || 0);
  const funding = Number(tk?.funding || 0) * 100;
  const nextFunding = Number(tk?.next_funding || tk?.funding || 0) * 100;

  // Init with BTC
  useEffect(() => {
    if (!selected && markets.length) {
      setSelected(markets.find(m => m.symbol === 'BTC') || markets[0]);
    }
  }, [markets, selected]);

  // Set limit price to mark
  useEffect(() => {
    if (markPrice > 0 && orderType === 'limit' && !price) {
      setPrice(String(markPrice));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, markPrice]);

  // Orderbook polling
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const load = async () => {
      const ob = await getOrderbook(selected.symbol);
      if (!cancelled) setOrderbook(ob);
    };
    load();
    const iv = window.setInterval(load, 2000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [selected]);

  const filteredMarkets = markets
    .filter(m => m.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(tickers[b.symbol]?.volume_24h || 0) - Number(tickers[a.symbol]?.volume_24h || 0));

  const entryPrice = orderType === 'market' ? markPrice : (Number(price) || markPrice);
  const amountNum = Number(amount) || 0;
  const positionValue = amountNum * entryPrice;
  const requiredMargin = leverage > 0 ? positionValue / leverage : positionValue;
  const liqPrice = side === 'long'
    ? entryPrice * (1 - 0.9 / leverage)
    : entryPrice * (1 + 0.9 / leverage);
  const maxLev = selected?.max_leverage || 20;

  async function handlePlaceOrder() {
    if (!wallet || !selected || amountNum <= 0) return;
    setPlacing(true);
    const r: CalcResult = {
      riskAmount: requiredMargin,
      positionSize: amountNum,
      positionValue,
      requiredMargin,
      marginPct: 0,
      slPct: 0,
      liquidationPrice: liqPrice,
      tp1: Number(tpPrice) || 0,
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
    await onExecute(r, selected.symbol);
    setPlacing(false);
  }

  // Quick amount buttons (% of available)
  const available = 11.60; // placeholder — ideally from accountInfo
  function setAmountPct(pct: number) {
    if (!markPrice || !leverage) return;
    const usd = available * pct / 100 * leverage;
    setAmount((usd / markPrice).toFixed(4));
  }

  return (
    <div className="flex flex-1 overflow-hidden bg-bg">

      {/* LEFT: Market list */}
      <div className="w-48 shrink-0 border-r border-border1 flex flex-col bg-surface overflow-hidden">
        <div className="px-2 py-2 border-b border-border1 shrink-0">
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface2 border border-border1 rounded px-2 py-1.5 text-[11px] text-text2 outline-none focus:border-accent placeholder-white/30" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredMarkets.map(m => {
            const t = tickers[m.symbol];
            const p = getMarkPrice(t);
            const chg = get24hChange(t);
            const active = selected?.symbol === m.symbol;
            return (
              <button key={m.symbol} onClick={() => { setSelected(m); setPrice(''); }}
                className={'w-full flex items-center gap-2 px-2 py-2 border-b border-border1/50 hover:bg-surface2 text-left transition-colors ' + (active ? 'bg-accent/15 border-l-2 border-l-accent' : '')}>
                <CoinLogo symbol={m.symbol} size={18} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-text1">{m.symbol}</div>
                  <div className="text-[9px] text-text3">{m.max_leverage}x</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono text-text2">${fmtPrice(p)}</div>
                  <div className={'text-[9px] font-semibold ' + (chg >= 0 ? 'text-success' : 'text-danger')}>
                    {chg >= 0 ? '+' : ''}{fmt(chg, 2)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CENTER: Pacifica iframe chart */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-border1">
        {/* Market stats bar */}
        {selected && (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-border1 bg-surface shrink-0">
            <div className="flex items-center gap-2">
              <CoinLogo symbol={selected.symbol} size={22} />
              <span className="text-[13px] font-bold text-white">{selected.symbol}-PERP</span>
            </div>
            <span className={'text-[18px] font-bold ' + (change24h >= 0 ? 'text-success' : 'text-danger')}>
              ${fmtPrice(markPrice)}
            </span>
            <span className={'text-[12px] font-semibold ' + (change24h >= 0 ? 'text-success' : 'text-danger')}>
              {change24h >= 0 ? '+' : ''}{fmt(change24h, 2)}%
            </span>
            <div className="flex gap-5 ml-2 text-[11px]">
              {[
                { label: '24h Vol', value: '$' + fmt(volume24h / 1e6, 2) + 'M' },
                { label: 'OI', value: '$' + fmt(oi / 1e6, 2) + 'M' },
                { label: 'Funding/8h', value: (funding >= 0 ? '+' : '') + fmt(funding, 4) + '%', color: funding >= 0 ? 'text-danger' : 'text-success' },
                { label: 'Next Funding', value: (nextFunding >= 0 ? '+' : '') + fmt(nextFunding, 4) + '%', color: nextFunding >= 0 ? 'text-danger' : 'text-success' },
              ].map(s => (
                <div key={s.label}>
                  <div className="text-[9px] text-text3 uppercase">{s.label}</div>
                  <div className={'text-[11px] font-semibold ' + (s.color || 'text-text2')}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pacifica iframe — full TradingView with indicators */}
        <div className="flex-1 relative overflow-hidden">
          {selected ? (
            <iframe
              ref={iframeRef}
              key={selected.symbol}
              src={`https://app.pacifica.fi/trade/${selected.symbol}`}
              className="w-full h-full border-0"
              allow="clipboard-read; clipboard-write"
              title={`${selected.symbol} Chart`}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text3">Select a market</div>
          )}
        </div>
      </div>

      {/* RIGHT: Orderbook + Order form */}
      <div className="w-72 shrink-0 flex flex-col bg-surface overflow-hidden">
        {/* Tab switcher */}
        <div className="flex border-b border-border1 shrink-0">
          {([['orderbook', 'Order Book'], ['trade', 'Place Order']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setRightTab(k)}
              className={'flex-1 py-2.5 text-[11px] font-semibold border-b-2 transition-all ' +
                (rightTab === k ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-white/70')}>
              {l}
            </button>
          ))}
        </div>

        {/* ORDERBOOK */}
        {rightTab === 'orderbook' && (
          <div className="flex-1 overflow-hidden">
            <OrderbookPanel orderbook={orderbook} markPrice={markPrice} />
          </div>
        )}

        {/* ORDER FORM */}
        {rightTab === 'trade' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Cross / Isolated + Leverage */}
            <div className="flex items-center gap-2">
              <div className="flex bg-surface2 border border-border1 rounded-lg overflow-hidden text-[11px]">
                <button onClick={() => setMarginMode('cross')}
                  className={'px-3 py-1.5 font-semibold transition-all ' +
                    (marginMode === 'cross' ? 'bg-surface text-white' : 'text-text3 hover:text-white/70')}>
                  Cross
                </button>
                <button onClick={() => setMarginMode('isolated')}
                  className={'px-3 py-1.5 font-semibold transition-all ' +
                    (marginMode === 'isolated' ? 'bg-surface text-white' : 'text-text3 hover:text-white/70')}>
                  Isolated
                </button>
              </div>
              <div className="flex items-center gap-1.5 ml-auto bg-surface2 border border-border1 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-surface2"
                onClick={() => {
                  const next = leverage < maxLev ? Math.min(leverage + 5, maxLev) : 1;
                  setLeverage(next);
                }}>
                <span className="text-[12px] font-bold text-accent">{leverage}x</span>
              </div>
            </div>

            {/* Long / Short */}
            <div className="flex rounded-lg overflow-hidden border border-border1">
              <button onClick={() => setSide('long')}
                className={'flex-1 py-2.5 text-[13px] font-bold transition-all ' +
                  (side === 'long' ? 'bg-success text-white' : 'bg-transparent text-text3 hover:text-success')}>
                Buy / Long
              </button>
              <button onClick={() => setSide('short')}
                className={'flex-1 py-2.5 text-[13px] font-bold transition-all ' +
                  (side === 'short' ? 'bg-danger text-white' : 'bg-transparent text-text3 hover:text-danger')}>
                Sell / Short
              </button>
            </div>

            {/* Order type */}
            <div className="flex bg-surface2 border border-border1 rounded-lg overflow-hidden text-[11px]">
              {(['limit', 'market'] as const).map(t => (
                <button key={t} onClick={() => setOrderType(t)}
                  className={'flex-1 py-1.5 font-semibold capitalize transition-all ' +
                    (orderType === t ? 'bg-surface text-white' : 'text-text3 hover:text-white/70')}>
                  {t}
                </button>
              ))}
            </div>

            {/* Leverage slider */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] text-text3 uppercase">Leverage</span>
                <span className="text-[11px] font-bold text-accent">{leverage}x</span>
              </div>
              <input type="range" min={1} max={maxLev} value={leverage}
                onChange={e => setLeverage(Number(e.target.value))}
                className="w-full accent-accent h-1" />
              <div className="flex justify-between text-[9px] text-text3 mt-1">
                <span>1x</span><span>{Math.round(maxLev / 4)}x</span><span>{Math.round(maxLev / 2)}x</span><span>{Math.round(maxLev * 3 / 4)}x</span><span>{maxLev}x</span>
              </div>
            </div>

            {/* Price (limit) */}
            {orderType === 'limit' && (
              <div>
                <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">Price (USD)</label>
                <div className="relative">
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                    placeholder={String(markPrice)}
                    className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] font-mono text-text1 outline-none focus:border-accent" />
                  <button onClick={() => setPrice(String(markPrice))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-accent hover:underline">
                    Mark
                  </button>
                </div>
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">
                Amount ({selected?.symbol || '—'})
              </label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-surface2 border border-border1 rounded-lg px-3 py-2 text-[12px] font-mono text-text1 outline-none focus:border-accent" />
              <div className="flex gap-1 mt-1.5">
                {[25, 50, 75, 100].map(pct => (
                  <button key={pct} onClick={() => setAmountPct(pct)}
                    className="flex-1 py-1 text-[10px] font-semibold bg-surface2 border border-border1 rounded hover:bg-surface2 text-text2 transition-colors">
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            {/* TP / SL toggles */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button onClick={() => setTpEnabled(v => !v)}
                  className={'relative w-8 h-4 rounded-full transition-colors ' + (tpEnabled ? 'bg-success' : 'bg-surface2')}>
                  <div className={'absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ' + (tpEnabled ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
                <span className="text-[11px] text-text2">Take Profit</span>
                {tpEnabled && (
                  <input type="number" value={tpPrice} onChange={e => setTpPrice(e.target.value)}
                    placeholder="Price" className="ml-auto w-28 bg-surface2 border border-border1 rounded px-2 py-1 text-[11px] font-mono text-text1 outline-none focus:border-success" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSlEnabled(v => !v)}
                  className={'relative w-8 h-4 rounded-full transition-colors ' + (slEnabled ? 'bg-danger' : 'bg-surface2')}>
                  <div className={'absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ' + (slEnabled ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
                <span className="text-[11px] text-text2">Stop Loss</span>
                {slEnabled && (
                  <input type="number" value={slPrice} onChange={e => setSlPrice(e.target.value)}
                    placeholder="Price" className="ml-auto w-28 bg-surface2 border border-border1 rounded px-2 py-1 text-[11px] font-mono text-text1 outline-none focus:border-danger" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setReduceOnly(v => !v)}
                  className={'relative w-8 h-4 rounded-full transition-colors ' + (reduceOnly ? 'bg-accent' : 'bg-surface2')}>
                  <div className={'absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ' + (reduceOnly ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
                <span className="text-[11px] text-text2">Reduce Only</span>
              </div>
            </div>

            {/* Order preview */}
            {amountNum > 0 && (
              <div className="bg-surface2 rounded-lg border border-border1 p-3 space-y-1.5">
                {[
                  { label: 'Position Value', value: '$' + fmt(positionValue, 2) },
                  { label: 'Required Margin', value: '$' + fmt(requiredMargin, 2) },
                  { label: 'Max Slippage', value: orderType === 'market' ? '3%' : '—' },
                  { label: 'Liq. Price (est.)', value: '$' + fmtPrice(liqPrice), color: 'text-danger' },
                  { label: 'Funding/8h', value: (funding >= 0 ? '+' : '') + fmt(funding, 4) + '%', color: funding >= 0 ? 'text-danger' : 'text-success' },
                ].map(row => (
                  <div key={row.label} className="flex justify-between">
                    <span className="text-[10px] text-text3">{row.label}</span>
                    <span className={'text-[11px] font-semibold ' + (row.color || 'text-text2')}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Place order */}
            <button onClick={handlePlaceOrder}
              disabled={!wallet || amountNum <= 0 || placing}
              className={'w-full py-3 rounded-xl text-[13px] font-bold transition-all disabled:opacity-40 ' +
                (side === 'long' ? 'bg-success hover:bg-success text-white' : 'bg-danger hover:bg-danger text-white')}>
              {placing ? 'Signing...' : !wallet ? 'Connect Wallet' :
                `${side === 'long' ? 'Buy / Long' : 'Sell / Short'} ${selected?.symbol || ''}`}
            </button>

            {amountNum > 0 && (
              <div className="text-[10px] text-text3 text-center">
                {marginMode === 'cross' ? 'Cross margin' : 'Isolated margin'} · {leverage}x leverage
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
