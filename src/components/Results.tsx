'use client';

import { useState } from 'react';
import { CalcResult } from './Calculator';
import { fmtPrice, fmt } from '@/lib/utils';
import { Position, AccountInfo } from '@/lib/pacifica';

interface ResultsProps {
  result: CalcResult | null;
  positions?: Position[];
  accountInfo: AccountInfo | null;
  accountSize: number;
  onExecute: (r: CalcResult) => void;
  walletConnected: boolean;
  market: string;
  winRate: number;
  onWinRateChange: (v: number) => void;
}

function StatRow({ label, value, color, highlight, copyValue }: {
  label: string; value: string; color?: string; highlight?: boolean; copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!copyValue) return;
    navigator.clipboard.writeText(copyValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className={`flex justify-between items-center px-4 py-2.5 hover:bg-surface2/50 transition-colors group ${highlight ? 'bg-accent/5' : ''}`}>
      <span className="text-[12px] text-text3">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`text-[13px] font-semibold ${color || 'text-text1'}`}>{value}</span>
        {copyValue && (
          <button
            onClick={copy}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] px-1.5 py-0.5 rounded bg-surface2 border border-border1 text-text3 hover:text-accent"
          >
            {copied ? '✓' : 'copy'}
          </button>
        )}
      </div>
    </div>
  );
}

function WarningBanner({ msg, type }: { msg: string; type: 'warn' | 'danger' | 'info' }) {
  const s = type === 'danger' ? 'bg-danger/8 border-danger/30 text-danger' : type === 'warn' ? 'bg-warn/8 border-warn/30 text-warn' : 'bg-accent/8 border-accent/30 text-accent';
  const icon = type === 'danger' ? '⚡' : type === 'warn' ? '⚠' : 'ℹ';
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold ${s}`}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span>{msg}</span>
    </div>
  );
}

export function Results({ result, accountInfo, accountSize, onExecute, walletConnected, market, winRate, onWinRateChange }: ResultsProps) {
  const equity = accountInfo ? Number(accountInfo.account_equity || accountInfo.balance || 0) : accountSize;
  const totalMarginUsed = accountInfo ? Number(accountInfo.total_margin_used || 0) : 0;

  const warnings: { msg: string; type: 'warn' | 'danger' | 'info' }[] = [];
  if (result) {
    if (result.marginPct > 50) warnings.push({ msg: 'Bu pozisyon hesabının %50\'sinden fazlasını margin olarak kullanıyor', type: 'danger' });
    if (result.leverage > 20) warnings.push({ msg: `${result.leverage}x kaldıraç çok yüksek — küçük hareketler likidasyon yaratabilir`, type: 'danger' });
    if (result.rrRatio < 1.5) warnings.push({ msg: 'Risk:Ödül 1.5 altında — bu trade olumsuz ödeme oranına sahip', type: 'warn' });
    if (result.fundingCostDaily > result.riskAmount * 0.1) warnings.push({ msg: `Günlük funding ($${fmt(result.fundingCostDaily, 2)}) risk tutarının %10\'undan fazla`, type: 'warn' });
    if (totalMarginUsed > 0 && equity > 0 && (totalMarginUsed + result.requiredMargin) / equity > 0.5) warnings.push({ msg: 'Bu pozisyon eklenince toplam margin kullanımı %50\'yi aşacak', type: 'warn' });
    if (result.slPct < 0.3) warnings.push({ msg: 'Stop loss çok sıkışık — normal volatilite tarafından tetiklenebilir', type: 'warn' });
  }

  // Win-rate adjusted EV
  const wr = winRate / 100;
  const ev = result ? (wr * result.riskAmount * result.rrRatio) - ((1 - wr) * result.riskAmount) : 0;
  const evPositive = ev >= 0;

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto bg-bg h-full">
      {result ? (
        <>
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((w, i) => <WarningBanner key={i} msg={w.msg} type={w.type} />)}
            </div>
          )}

          {/* RR + EV card */}
          <div className={`rounded-xl border p-3.5 ${result.rrRatio >= 2 ? 'bg-success/5 border-success/25' : result.rrRatio >= 1.5 ? 'bg-warn/5 border-warn/20' : 'bg-danger/5 border-danger/20'}`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-0.5">Risk : Reward</div>
                <div className={`text-[22px] font-bold ${result.rrRatio >= 2 ? 'text-success' : result.rrRatio >= 1.5 ? 'text-warn' : 'text-danger'}`}>
                  1 : {fmt(result.rrRatio, 1)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-text3 uppercase font-semibold tracking-wide mb-0.5">Expected Value</div>
                <div className={`text-[18px] font-bold ${evPositive ? 'text-success' : 'text-danger'}`}>
                  {evPositive ? '+' : ''}${fmt(ev, 2)}
                </div>
                {/* Win rate input */}
                <div className="flex items-center gap-1.5 justify-end mt-1">
                  <span className="text-[9px] text-text3">Win rate</span>
                  <input
                    type="number"
                    min={1} max={99}
                    value={winRate}
                    onChange={e => onWinRateChange(Math.max(1, Math.min(99, Number(e.target.value))))}
                    className="w-10 text-center bg-surface2 border border-border1 rounded text-[10px] text-text1 outline-none focus:border-accent px-1 py-0.5"
                  />
                  <span className="text-[9px] text-text3">%</span>
                </div>
              </div>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden mt-1">
              <div className="bg-danger/70" style={{ width: `${(1 / (1 + result.rrRatio)) * 100}%` }} />
              <div className="bg-success/70 flex-1" />
            </div>
            <div className="flex justify-between text-[9px] mt-1 text-text3">
              <span className="text-danger">Risk ${fmt(result.riskAmount, 2)}</span>
              <span className="text-success">Reward ${fmt(result.riskAmount * result.rrRatio, 2)}</span>
            </div>
          </div>

          {/* Position Size */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border1 bg-surface2">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Position Size</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${result.side === 'long' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                {result.side.toUpperCase()}
              </span>
            </div>
            <div className="divide-y divide-border1">
              <StatRow label="Contracts" value={fmt(result.positionSize, 4)} color="text-accent font-bold" />
              <StatRow label="Position Value" value={'$' + fmt(result.positionValue, 2)} />
              <StatRow label="Required Margin" value={'$' + fmt(result.requiredMargin, 2)} color={result.marginPct > 50 ? 'text-danger' : undefined} />
              <StatRow label="Margin Usage" value={fmt(result.marginPct, 1) + '%'} color={result.marginPct > 50 ? 'text-danger' : result.marginPct > 25 ? 'text-warn' : 'text-success'} />
              <StatRow label="Leverage" value={result.leverage + 'x'} color={result.leverage > 20 ? 'text-danger' : 'text-accent'} />
            </div>
          </div>

          {/* Risk / Reward — with copy buttons on SL/TP */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border1 bg-surface2">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Risk / Reward</span>
            </div>
            <div className="divide-y divide-border1">
              <StatRow label="Max Risk ($)" value={'$' + fmt(result.riskAmount, 2)} color="text-danger" />
              <StatRow label="Stop Loss" value={'$' + fmtPrice(result.stopLoss)} color="text-danger" copyValue={String(result.stopLoss)} />
              <StatRow label="SL Distance" value={fmt(result.slPct, 2) + '%'} />
              <StatRow label="Liquidation Price" value={'$' + fmtPrice(result.liquidationPrice)} color="text-danger" />
              <StatRow label="Break-Even Price" value={'$' + fmtPrice(result.breakEvenPrice)} color="text-text3" />
              <StatRow
                label={`TP @ 1:${fmt(result.rrRatio, 1)}`}
                value={'$' + fmtPrice(result.tp1)}
                color="text-success"
                highlight
                copyValue={String(result.tp1)}
              />
              {result.rrRatio < 2 && (
                <StatRow label="TP @ 1:2" value={'$' + fmtPrice(result.tp2)} color="text-success" copyValue={String(result.tp2)} />
              )}
              {result.rrRatio < 3 && (
                <StatRow label="TP @ 1:3" value={'$' + fmtPrice(result.tp3)} color="text-success" copyValue={String(result.tp3)} />
              )}
            </div>
          </div>

          {/* Funding Cost */}
          <div className="bg-surface rounded-xl border border-border1 shadow-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border1 bg-surface2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Funding Cost (tutma)</span>
              <span className="text-[9px] text-text3">sabit oran varsayımı</span>
            </div>
            <div className="divide-y divide-border1">
              <StatRow label="Günlük Maliyet" value={'$' + fmt(result.fundingCostDaily, 4)} color={result.fundingCostDaily > 0 ? 'text-danger' : 'text-success'} />
              <StatRow label="Haftalık Maliyet" value={'$' + fmt(result.fundingCostWeekly, 2)} color={result.fundingCostWeekly > 0 ? 'text-danger' : 'text-success'} />
              <StatRow
                label="Haftalık / Risk"
                value={result.riskAmount > 0 ? fmt((result.fundingCostWeekly / result.riskAmount) * 100, 1) + '%' : '—'}
                color={result.fundingCostWeekly / result.riskAmount > 0.2 ? 'text-danger' : 'text-text3'}
              />
            </div>
          </div>

          <button
            onClick={() => onExecute(result)}
            disabled={!walletConnected}
            className={`w-full py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-40 shadow-card-md ${result.side === 'long' ? 'bg-success text-white hover:opacity-90' : 'bg-danger text-white hover:opacity-90'}`}>
            {walletConnected ? `${result.side.toUpperCase()} Order — ${market}` : 'Cüzdanı Bağla'}
          </button>
        </>
      ) : (
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-text3">
            <div className="w-14 h-14 rounded-2xl border border-dashed border-border2 flex items-center justify-center text-2xl">◎</div>
            <p className="text-sm text-text2 font-semibold">Hesaplamayı doldur</p>
            <p className="text-xs text-center leading-relaxed max-w-[200px]">
              Giriş fiyatı, stop loss ve hesap büyüklüğünü girerek pozisyon büyüklüğünü hesapla
            </p>
          </div>
          <div className="bg-surface rounded-xl border border-border1 p-4 space-y-3">
            <div className="text-[10px] font-bold text-text3 uppercase tracking-wide">Hızlı Referans</div>
            <div className="space-y-2 text-[11px]">
              {[
                { icon: '🟢', text: 'Her trade\'de risk ≤ %1-2 — uzun ömürlülük için' },
                { icon: '📐', text: 'Girmeden önce minimum 1:1.5 R:R' },
                { icon: '⚡', text: 'Yüksek kaldıraç = sıkışık likidasyon mesafesi' },
                { icon: '💸', text: 'Funding, tutulan pozisyonlarda günlük birikmekte' },
                { icon: '🎯', text: 'Win rate + R:R birlikte pozitif beklenti değeri yaratır' },
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-2 text-text3">
                  <span>{tip.icon}</span>
                  <span>{tip.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}