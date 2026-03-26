'use client';

import { useState, useEffect } from 'react';
import {
  Position, Ticker, OpenOrder,
  TradeHistory, FundingHistory,
  getOpenOrders, getOrderHistory, getTradeHistory, getFundingHistory
} from '@/lib/pacifica';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtPrice, getMarkPrice } from '@/lib/utils';

interface AccountTabsProps {
  positions: Position[];
  tickers: Record<string, Ticker>;
  wallet: string | null;
}

type Tab = 'positions' | 'open_orders' | 'trade_history' | 'order_history' | 'funding_history';

function EmptyRow({ cols, msg }: { cols: number; msg: string }) {
  return (
    <tr><td colSpan={cols} className="py-8 text-center text-text3 text-sm">{msg}</td></tr>
  );
}

function SideBadge({ side }: { side: string }) {
  const isLong = side.includes('long') || side === 'bid';
  const label = side.includes('open') ? (isLong ? 'Open Long' : 'Open Short') :
    side.includes('close') ? (isLong ? 'Close Long' : 'Close Short') :
    side === 'bid' ? 'Long' : side === 'ask' ? 'Short' : side;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
      {label.toUpperCase()}
    </span>
  );
}

export function AccountTabs({ positions, tickers, wallet }: AccountTabsProps) {
  const [tab, setTab] = useState<Tab>('positions');
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<OpenOrder[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([]);
  const [fundingHistory, setFundingHistory] = useState<FundingHistory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet) return;
    async function load() {
      setLoading(true);
      if (tab === 'open_orders') setOpenOrders(await getOpenOrders(wallet!));
      else if (tab === 'order_history') setOrderHistory(await getOrderHistory(wallet!, 100));
      else if (tab === 'trade_history') setTradeHistory(await getTradeHistory(wallet!, 100));
      else if (tab === 'funding_history') setFundingHistory(await getFundingHistory(wallet!));
      setLoading(false);
    }
    load();
  }, [tab, wallet]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'positions', label: 'Positions', count: positions.length },
    { key: 'open_orders', label: 'Open Orders', count: openOrders.length },
    { key: 'trade_history', label: 'Trade History' },
    { key: 'order_history', label: 'Order History' },
    { key: 'funding_history', label: 'Funding History' },
  ];

  const thClass = "px-3 py-2 text-[10px] font-semibold text-text3 uppercase tracking-wide text-left whitespace-nowrap";
  const tdClass = "px-3 py-2 text-[11px] text-text2 border-b border-border1";

  return (
    <div className="flex flex-col border-t border-border1 bg-surface" style={{ height: 200 }}>
      {/* Tab bar */}
      <div className="flex border-b border-border1 shrink-0 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={'px-4 py-2 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-all flex items-center gap-1.5 ' +
              (tab === t.key ? 'border-accent text-accent' : 'border-transparent text-text3 hover:text-text2')}>
            {t.label}
            {t.count !== undefined && (
              <span className={'text-[9px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center ' +
                (tab === t.key ? 'bg-accent/15 text-accent' : 'bg-surface2 text-text3')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full gap-2 text-text3">
            <div className="w-4 h-4 border-2 border-border2 border-t-accent rounded-full animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        )}

        {!loading && tab === 'positions' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface2 border-b border-border1">
              <tr>
                <th className={thClass}>Symbol</th>
                <th className={thClass}>Side</th>
                <th className={thClass + ' text-right'}>Size</th>
                <th className={thClass + ' text-right'}>Entry Price</th>
                <th className={thClass + ' text-right'}>Mark Price</th>
                <th className={thClass + ' text-right'}>Unrealized PnL</th>
                <th className={thClass + ' text-right'}>Margin</th>
                <th className={thClass + ' text-right'}>Funding</th>
              </tr>
            </thead>
            <tbody>
              {positions.length > 0 ? positions.map((p, i) => {
                const tk = tickers[p.symbol];
                const mark = getMarkPrice(tk);
                const entry = Number(p.entry_price || 0);
                const size = Number(p.amount || 0);
                const isLong = p.side === 'bid';
                const pnl = isLong ? (mark - entry) * size : (entry - mark) * size;
                const margin = Number((p as { margin?: string }).margin || 0);
                const funding = Number(p.funding || 0);
                return (
                  <tr key={i} className="hover:bg-surface2/50 transition-colors">
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        <CoinLogo symbol={p.symbol} size={18} />
                        <span className="font-semibold text-text1">{p.symbol}</span>
                      </div>
                    </td>
                    <td className={tdClass}><SideBadge side={p.side} /></td>
                    <td className={tdClass + ' text-right font-mono'}>{fmt(size, 4)}</td>
                    <td className={tdClass + ' text-right font-mono'}>${fmtPrice(entry)}</td>
                    <td className={tdClass + ' text-right font-mono'}>${fmtPrice(mark)}</td>
                    <td className={tdClass + ' text-right font-mono font-semibold ' + (pnl >= 0 ? 'text-success' : 'text-danger')}>
                      {pnl !== 0 ? (pnl >= 0 ? '+' : '') + '$' + fmt(pnl, 2) : '—'}
                    </td>
                    <td className={tdClass + ' text-right font-mono'}>{margin > 0 ? '$' + fmt(margin, 2) : '—'}</td>
                    <td className={tdClass + ' text-right font-mono ' + (funding >= 0 ? 'text-danger' : 'text-success')}>
                      {funding !== 0 ? (funding >= 0 ? '+' : '') + '$' + fmt(funding, 4) : '—'}
                    </td>
                  </tr>
                );
              }) : <EmptyRow cols={8} msg="No open positions" />}
            </tbody>
          </table>
        )}

        {!loading && tab === 'open_orders' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface2 border-b border-border1">
              <tr>
                <th className={thClass}>Symbol</th>
                <th className={thClass}>Type</th>
                <th className={thClass}>Side</th>
                <th className={thClass + ' text-right'}>Price</th>
                <th className={thClass + ' text-right'}>Amount</th>
                <th className={thClass + ' text-right'}>Filled</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Time</th>
              </tr>
            </thead>
            <tbody>
              {openOrders.length > 0 ? openOrders.map((o, i) => (
                <tr key={i} className="hover:bg-surface2/50">
                  <td className={tdClass}>
                    <div className="flex items-center gap-2"><CoinLogo symbol={o.symbol} size={16} /><span className="font-semibold text-text1">{o.symbol}</span></div>
                  </td>
                  <td className={tdClass + ' capitalize'}>{o.order_type?.replace('_', ' ') || '—'}</td>
                  <td className={tdClass}><SideBadge side={o.side} /></td>
                  <td className={tdClass + ' text-right font-mono'}>${fmtPrice(Number(o.price))}</td>
                  <td className={tdClass + ' text-right font-mono'}>{fmt(Number(o.amount), 4)}</td>
                  <td className={tdClass + ' text-right font-mono text-success'}>{fmt(Number(o.filled_amount || 0), 4)}</td>
                  <td className={tdClass}>
                    <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full font-semibold">{o.status || 'Open'}</span>
                  </td>
                  <td className={tdClass + ' text-text3'}>{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                </tr>
              )) : <EmptyRow cols={8} msg={!wallet ? 'Connect wallet to view orders' : 'No open orders'} />}
            </tbody>
          </table>
        )}

        {!loading && tab === 'trade_history' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface2 border-b border-border1">
              <tr>
                <th className={thClass}>Time</th>
                <th className={thClass}>Symbol</th>
                <th className={thClass}>Side</th>
                <th className={thClass + ' text-right'}>Price</th>
                <th className={thClass + ' text-right'}>Amount</th>
                <th className={thClass + ' text-right'}>Fee</th>
                <th className={thClass + ' text-right'}>Realized PnL</th>
              </tr>
            </thead>
            <tbody>
              {tradeHistory.length > 0 ? tradeHistory.map((t, i) => {
                const pnl = Number(t.realized_pnl || 0);
                return (
                  <tr key={i} className="hover:bg-surface2/50">
                    <td className={tdClass + ' text-text3'}>{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-2"><CoinLogo symbol={t.symbol} size={16} /><span className="font-semibold text-text1">{t.symbol}</span></div>
                    </td>
                    <td className={tdClass}><SideBadge side={t.side} /></td>
                    <td className={tdClass + ' text-right font-mono'}>${fmtPrice(Number(t.price))}</td>
                    <td className={tdClass + ' text-right font-mono'}>{fmt(Number(t.amount), 4)}</td>
                    <td className={tdClass + ' text-right font-mono text-warn'}>${fmt(Number(t.fee || 0), 4)}</td>
                    <td className={tdClass + ' text-right font-mono font-semibold ' + (pnl >= 0 ? 'text-success' : 'text-danger')}>
                      {pnl !== 0 ? (pnl >= 0 ? '+' : '') + '$' + fmt(pnl, 2) : '—'}
                    </td>
                  </tr>
                );
              }) : <EmptyRow cols={7} msg={!wallet ? 'Connect wallet to view history' : 'No trade history'} />}
            </tbody>
          </table>
        )}

        {!loading && tab === 'order_history' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface2 border-b border-border1">
              <tr>
                <th className={thClass}>Time</th>
                <th className={thClass}>Symbol</th>
                <th className={thClass}>Type</th>
                <th className={thClass}>Side</th>
                <th className={thClass + ' text-right'}>Price</th>
                <th className={thClass + ' text-right'}>Amount</th>
                <th className={thClass + ' text-right'}>Filled</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orderHistory.length > 0 ? orderHistory.map((o, i) => (
                <tr key={i} className="hover:bg-surface2/50">
                  <td className={tdClass + ' text-text3'}>{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                  <td className={tdClass}>
                    <div className="flex items-center gap-2"><CoinLogo symbol={o.symbol} size={16} /><span className="font-semibold text-text1">{o.symbol}</span></div>
                  </td>
                  <td className={tdClass + ' capitalize'}>{o.order_type?.replace('_', ' ') || '—'}</td>
                  <td className={tdClass}><SideBadge side={o.side} /></td>
                  <td className={tdClass + ' text-right font-mono'}>${fmtPrice(Number(o.price))}</td>
                  <td className={tdClass + ' text-right font-mono'}>{fmt(Number(o.amount), 4)}</td>
                  <td className={tdClass + ' text-right font-mono'}>{fmt(Number(o.filled_amount || 0), 4)}</td>
                  <td className={tdClass}>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      o.status === 'filled' ? 'bg-success/10 text-success' :
                      o.status === 'cancelled' ? 'bg-danger/10 text-danger' : 'bg-surface2 text-text3'}`}>
                      {o.status || '—'}
                    </span>
                  </td>
                </tr>
              )) : <EmptyRow cols={8} msg={!wallet ? 'Connect wallet to view orders' : 'No order history'} />}
            </tbody>
          </table>
        )}

        {!loading && tab === 'funding_history' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface2 border-b border-border1">
              <tr>
                <th className={thClass}>Time</th>
                <th className={thClass}>Symbol</th>
                <th className={thClass + ' text-right'}>Rate</th>
                <th className={thClass + ' text-right'}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {fundingHistory.length > 0 ? fundingHistory.map((f, i) => {
                const amt = Number(f.amount || 0);
                const rate = Number(f.rate || 0);
                return (
                  <tr key={i} className="hover:bg-surface2/50">
                    <td className={tdClass + ' text-text3'}>{f.timestamp ? new Date(f.timestamp).toLocaleString() : '—'}</td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-2"><CoinLogo symbol={f.symbol} size={16} /><span className="font-semibold text-text1">{f.symbol}</span></div>
                    </td>
                    <td className={tdClass + ' text-right font-mono ' + (rate >= 0 ? 'text-danger' : 'text-success')}>
                      {(rate >= 0 ? '+' : '') + fmt(rate * 100, 4)}%
                    </td>
                    <td className={tdClass + ' text-right font-mono font-semibold ' + (amt >= 0 ? 'text-success' : 'text-danger')}>
                      {(amt >= 0 ? '+' : '') + '$' + fmt(Math.abs(amt), 4)}
                    </td>
                  </tr>
                );
              }) : <EmptyRow cols={4} msg={!wallet ? 'Connect wallet to view funding history' : 'No funding history'} />}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
