'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useCopyTrading,
  SortField,
  LeaderboardEntry,
  FavoriteTrader,
  TraderTrade,
} from '@/hooks/useCopyTrading';
import { CoinLogo } from './CoinLogo';
import { fmt, fmtShortAddr, fmtPrice, getMarkPrice } from '@/lib/utils';
import { Market, Ticker, AccountInfo, getAccountInfo, getPositions, getEquityHistory, getTradeHistory, getPortfolioStats, getTradesHistory, getOpenOrders, getOrderHistory, getFundingHistory, PortfolioStats } from '@/lib/pacifica';
import { CalcResult } from './Calculator';
import { submitMarketOrder, submitLimitOrder, updateLeverage, toBase58, roundToTick } from '@/lib/pacificaSigning';
import * as nacl from 'tweetnacl';
import { useOrderLog } from '@/hooks/useOrderLog';
import { useTraderScore } from '@/hooks/useTraderScore';
import { ScoreBadge, ScoreCard } from '@/components/ScoreBadge';
import { STYLE_META } from '@/lib/traderScore';

// ─── CopyTrade types & storage ───────────────────────────────────────────────

const BUILDER_CODE = 'PACIFICALENS';
const CT_STORAGE       = 'pacifica_copytrade_v2';
const CT_KNOWN_STORAGE = 'pacifica_ct_known_v1'; // persist known symbols across page reloads

interface CopyTradeConfig {
  agentPrivateKey: string;
  agentPublicKey:  string;
  marginUsd:       number;
  leverageMode:    'mirror' | 'custom';
  customLeverage:  number;
  slEnabled: boolean; slPct: number;
  tpEnabled: boolean; tpPct: number;
  maxPositions:    number;
  active:          boolean;
}

const DEFAULT_CT: CopyTradeConfig = {
  agentPrivateKey: '', agentPublicKey: '',
  marginUsd: 50,
  leverageMode: 'mirror', customLeverage: 10,
  slEnabled: false, slPct: 5,
  tpEnabled: false, tpPct: 10,
  maxPositions: 5, active: false,
};

interface CTLog { id: string; ts: number; symbol: string; side: string; action: 'opened'|'closed'|'skipped'|'error'|'info'; msg: string; }

function loadCT(): Record<string, CopyTradeConfig> {
  try { const r = typeof window !== 'undefined' ? localStorage.getItem(CT_STORAGE) : null; return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveCT(addr: string, cfg: CopyTradeConfig) {
  try { const a = loadCT(); a[addr] = cfg; localStorage.setItem(CT_STORAGE, JSON.stringify(a)); } catch { /**/ }
}

// Persist known symbols so page refresh doesn't cause duplicate entries
function loadKnown(traderAccount: string): Set<string> {
  try {
    const r = typeof window !== 'undefined' ? localStorage.getItem(CT_KNOWN_STORAGE) : null;
    const all: Record<string, string[]> = r ? JSON.parse(r) : {};
    return new Set(all[traderAccount] ?? []);
  } catch { return new Set(); }
}
function saveKnown(traderAccount: string, known: Set<string>) {
  try {
    const r = typeof window !== 'undefined' ? localStorage.getItem(CT_KNOWN_STORAGE) : null;
    const all: Record<string, string[]> = r ? JSON.parse(r) : {};
    all[traderAccount] = Array.from(known);
    localStorage.setItem(CT_KNOWN_STORAGE, JSON.stringify(all));
  } catch { /**/ }
}
function clearKnown(traderAccount: string) {
  try {
    const r = typeof window !== 'undefined' ? localStorage.getItem(CT_KNOWN_STORAGE) : null;
    const all: Record<string, string[]> = r ? JSON.parse(r) : {};
    delete all[traderAccount];
    localStorage.setItem(CT_KNOWN_STORAGE, JSON.stringify(all));
  } catch { /**/ }
}

// ─── Base58 validation ────────────────────────────────────────────────────────

const B58_CHARSET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

function isValidBase58(s: string, expectedLen: number, tolerance = 5): boolean {
  if (!s || !B58_RE.test(s)) return false;
  return Math.abs(s.length - expectedLen) <= tolerance;
}

// ─── Ed25519 helpers ──────────────────────────────────────────────────────────

const B58 = B58_CHARSET;
function fromB58(s: string): Uint8Array {
  const bytes = [0];
  for (const c of s) {
    const idx = B58.indexOf(c); if (idx < 0) throw new Error('bad b58');
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let lz = 0; for (const c of s) { if (c === '1') lz++; else break; }
  return new Uint8Array([...new Array(lz).fill(0), ...bytes.reverse()]);
}

async function agentSign(pkB58: string, msg: Uint8Array): Promise<string> {
  const raw = fromB58(pkB58);
  // tweetnacl expects 32-byte seed; some keys are stored as 64-byte (seed+pubkey)
  const seed = raw.length === 64 ? raw.slice(0, 32) : raw;
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  // nacl.sign.detached() returns ONLY the 64-byte signature (correct for Pacifica)
  // nacl.sign() returns sig+msg concatenated which is WRONG
  const sig = nacl.sign.detached(msg, keypair.secretKey);
  return toBase58(sig);
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtN(n: number, showSign = false): string {
  const sign = showSign ? (n >= 0 ? '+' : '') : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return sign + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e9, 2) + 'B';
  if (abs >= 1e6) return sign + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e6, 2) + 'M';
  if (abs >= 1e3) return sign + (n < 0 ? '-' : '') + '$' + fmt(abs / 1e3, 1) + 'K';
  return sign + (n < 0 ? '-$' : '$') + fmt(abs, 0);
}

function fmtTime(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function sideLabel(side: string): { label: string; isLong: boolean } {
  const s = side.toLowerCase();
  if (s.includes('long') || s === 'bid') return { label: s.includes('close') ? 'Close Long' : 'Long', isLong: true };
  if (s.includes('short') || s === 'ask') return { label: s.includes('close') ? 'Close Short' : 'Short', isLong: false };
  return { label: side, isLong: true };
}

// ─── Sort column header ───────────────────────────────────────────────────────

function Th({ label, field, cur, dir, onClick }: {
  label: string;
  field: SortField;
  cur: SortField;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  const active = cur === field;
  return (
    <th
      onClick={onClick}
      className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-right cursor-pointer hover:text-accent select-none whitespace-nowrap transition-colors"
    >
      {label}
      <span className={'ml-1 ' + (active ? 'text-accent' : 'text-border2')}>
        {active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}
      </span>
    </th>
  );
}

// ─── CopyTradePanel ──────────────────────────────────────────────────────────

function CopyTradePanel({
  traderAccount, myAccount, markets, tickers, onToast,
}: {
  traderAccount: string;
  myAccount:     string | null;
  markets:       Market[];
  tickers:       Record<string, Ticker>;
  onToast:       (msg: string, type: 'success'|'error'|'info') => void;
}) {
  const [cfg, setCfg]           = useState<CopyTradeConfig>(() => ({ ...DEFAULT_CT, ...loadCT()[traderAccount] }));
  const [logs, setLogs]         = useState<CTLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [running, setRunning]   = useState(false);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [myPosCount, setMyPosCount] = useState(0);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const knownRef        = useRef<Set<string>>(loadKnown(traderAccount));
  const amountRef       = useRef<Map<string, number>>(new Map()); // track trader's position sizes for partial close detection
  const firstPollRef    = useRef(knownRef.current.size === 0); // if we have persisted known symbols, skip first-poll snapshot
  // Hold latest poll fn in a ref so interval doesn't restart on every tickers update
  const pollFnRef       = useRef<(() => Promise<void>) | null>(null);

  const log = (e: Omit<CTLog,'id'|'ts'>) =>
    setLogs(p => [{ id: crypto.randomUUID(), ts: Date.now(), ...e }, ...p].slice(0, 120));

  useEffect(() => { saveCT(traderAccount, cfg); }, [cfg, traderAccount]);

  // Per-symbol order sizing
  function sizeOrder(symbol: string, traderPos: import('@/lib/pacifica').Position) {
    const tk  = tickers[symbol];
    const px  = getMarkPrice(tk);
    if (!px || px <= 0) return null;

    const mkt    = markets.find(m => m.symbol === symbol);
    const maxLev = mkt ? Number(mkt.max_leverage) : 20;
    const lot    = mkt?.lot_size ? Number(mkt.lot_size) : 0.0001;
    const dec    = Math.max(0, Math.ceil(-Math.log10(lot)));

    let lev: number;
    if (cfg.leverageMode === 'mirror') {
      // use trader's actual leverage: prefer the leverage field, fall back to computing from margin
      if (traderPos.leverage && Number(traderPos.leverage) > 0) {
        lev = Number(traderPos.leverage);
      } else if (traderPos.margin && Number(traderPos.margin) > 0) {
        lev = Math.round((Number(traderPos.entry_price) * Number(traderPos.amount)) / Number(traderPos.margin));
      } else {
        lev = 1;
      }
      lev = Math.max(1, Math.min(lev, maxLev));
    } else {
      lev = Math.max(1, Math.min(cfg.customLeverage, maxLev));
    }

    // Deduct taker fee (0.04%) + builder fee (0.01%) from margin before sizing
    // to prevent "Insufficient balance" errors from the exchange
    const TOTAL_FEE_RATE = 0.0004 + 0.001; // taker 0.04% + builder 0.1%
    const notional = cfg.marginUsd * lev;
    const estimatedFee = notional * TOTAL_FEE_RATE;
    const effectiveMargin = Math.max(0, cfg.marginUsd - estimatedFee);

    const contracts = (effectiveMargin * lev) / px;
    // min_order_size is in USD notional, not contracts
    const minNotionalUsd = mkt?.min_order_size ? Number(mkt.min_order_size) : 0;
    const contractsNotional = contracts * px;
    const belowMin = minNotionalUsd > 0 && contractsNotional < minNotionalUsd;
    // If below min notional, bump contracts up to meet the minimum
    const minContracts = minNotionalUsd > 0 ? minNotionalUsd / px : 0;
    const finalContracts = belowMin ? minContracts : contracts;

    return { contracts: finalContracts.toFixed(dec), lev, px, belowMin, minSize: minNotionalUsd };
  }

  const poll = useCallback(async () => {
    if (!myAccount || !cfg.agentPrivateKey || !cfg.agentPublicKey) return;
    setRunning(true);
    try {
      const { getPositions: gp } = await import('@/lib/pacifica');
      const [tPs, mPs] = await Promise.all([gp(traderAccount), gp(myAccount)]);
      setLastPoll(new Date());
      setMyPosCount(mPs.length);

      const myMap = new Map(mPs.map((p: import('@/lib/pacifica').Position) => [p.symbol, p]));
      const trMap = new Map(tPs.map((p: import('@/lib/pacifica').Position) => [p.symbol, p]));

      // First poll – snapshot only (skip if we loaded persisted known symbols)
      if (firstPollRef.current) {
        firstPollRef.current = false;
        tPs.forEach((p: import('@/lib/pacifica').Position) => {
          knownRef.current.add(p.symbol);
          amountRef.current.set(p.symbol, Number(p.amount));
        });
        saveKnown(traderAccount, knownRef.current);
        log({ symbol: '—', side: '—', action: 'skipped', msg: `Snapshot: ${tPs.length} open position(s). Watching for new entries...` });
        return;
      }

      // Update amount tracking for existing known positions
      for (const tp of tPs as import('@/lib/pacifica').Position[]) {
        if (knownRef.current.has(tp.symbol)) {
          amountRef.current.set(tp.symbol, Number(tp.amount));
        }
      }

      // ── New positions trader opened ─────────────────────────────────────────
      for (const tp of tPs as import('@/lib/pacifica').Position[]) {
        if (knownRef.current.has(tp.symbol)) continue;
        knownRef.current.add(tp.symbol);
        amountRef.current.set(tp.symbol, Number(tp.amount));
        saveKnown(traderAccount, knownRef.current);

        if (myMap.has(tp.symbol))                                        { log({ symbol: tp.symbol, side: tp.side, action: 'skipped', msg: 'Already holding this symbol' }); continue; }
        if (cfg.maxPositions > 0 && mPs.length >= cfg.maxPositions)     { log({ symbol: tp.symbol, side: tp.side, action: 'skipped', msg: `Max positions (${cfg.maxPositions}) reached` }); continue; }

        const order = sizeOrder(tp.symbol, tp);
        if (!order) { log({ symbol: tp.symbol, side: tp.side, action: 'error', msg: 'Cannot size order (no price available)' }); continue; }

        const { contracts, lev, px, belowMin, minSize } = order;
        if (belowMin) {
          log({ symbol: tp.symbol, side: tp.side, action: 'info',
            msg: `Margin $${cfg.marginUsd} below $${minSize} min notional — bumping contracts to meet minimum` });
        }
        const side    = tp.side as 'bid'|'ask';
        const isLong  = side === 'bid';
        const mkt     = markets.find(m => m.symbol === tp.symbol);
        const slPx    = cfg.slEnabled ? (isLong ? px*(1-cfg.slPct/100) : px*(1+cfg.slPct/100)) : null;
        const tpPx    = cfg.tpEnabled ? (isLong ? px*(1+cfg.tpPct/100) : px*(1-cfg.tpPct/100)) : null;

        try {
          const { buildSigningPayload, buildRequestBody, updateLeverage: doUpdateLev } = await import('@/lib/pacificaSigning');

          // Leverage must be set per symbol before placing order (required by Pacifica API)
          const levResult = await doUpdateLev(
            myAccount, tp.symbol, lev,
            async (msg: Uint8Array) => agentSign(cfg.agentPrivateKey, msg),
            cfg.agentPublicKey,
          );
          if (!levResult.success) {
            // Log the warning but proceed — leverage may already be set correctly on the account
            log({ symbol: tp.symbol, side: tp.side, action: 'info', msg: `Leverage set warning (proceeding anyway): ${levResult.error}` });
          }

          const data: Record<string,unknown> = {
            symbol: tp.symbol, amount: contracts, side, reduce_only: false,
            slippage_percent: '1', client_order_id: crypto.randomUUID(),
            ...(slPx ? { stop_loss:   { stop_price: roundToTick(slPx, mkt?.tick_size || '0.01') } } : {}),
            ...(tpPx ? { take_profit: { stop_price: roundToTick(tpPx, mkt?.tick_size || '0.01') } } : {}),
          };
          const { payload, timestamp } = buildSigningPayload('create_market_order', data);
          const sig  = await agentSign(cfg.agentPrivateKey, new TextEncoder().encode(payload));
          const body = { ...buildRequestBody(myAccount, sig, timestamp, data), agent_wallet: cfg.agentPublicKey };
          const res  = await fetch('https://api.pacifica.fi/api/v1/orders/create_market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const json = await res.json();
          if (json.success) {
            log({ symbol: tp.symbol, side: tp.side, action: 'opened',
              msg: `${isLong?'Long':'Short'} opened · $${cfg.marginUsd} margin · ${lev}× leverage${cfg.slEnabled?` · SL ${cfg.slPct}%`:''}${cfg.tpEnabled?` · TP ${cfg.tpPct}%`:''}` });
            onToast(`Copy Trade: ${tp.symbol} ${isLong?'Long':'Short'} opened (${lev}×)`, 'success');
          } else {
            log({ symbol: tp.symbol, side: tp.side, action: 'error', msg: json.error || JSON.stringify(json) });
          }
        } catch (e) { log({ symbol: tp.symbol, side: tp.side, action: 'error', msg: String(e) }); }
      }

      // ── Positions trader fully closed ───────────────────────────────────────
      for (const sym of Array.from(knownRef.current) as string[]) {
        if (trMap.has(sym)) continue;
        knownRef.current.delete(sym);
        amountRef.current.delete(sym);
        saveKnown(traderAccount, knownRef.current);
        const mine = myMap.get(sym);
        if (!mine) continue;
        try {
          const { buildSigningPayload, buildRequestBody } = await import('@/lib/pacificaSigning');
          const data: Record<string,unknown> = {
            symbol: sym, amount: mine.amount,
            side: mine.side === 'bid' ? 'ask' : 'bid',
            reduce_only: true, slippage_percent: '1',
            client_order_id: crypto.randomUUID(),
          };
          const { payload, timestamp } = buildSigningPayload('create_market_order', data);
          const sig  = await agentSign(cfg.agentPrivateKey, new TextEncoder().encode(payload));
          const body = { ...buildRequestBody(myAccount as string, sig, timestamp, data), agent_wallet: cfg.agentPublicKey };
          const res  = await fetch('https://api.pacifica.fi/api/v1/orders/create_market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const json = await res.json();
          if (json.success) {
            log({ symbol: sym, side: mine.side as string, action: 'closed', msg: 'Trader exited → position closed' });
            onToast(`Copy Trade: ${sym} closed (trader exited)`, 'info');
          }
        } catch (e) { log({ symbol: sym, side: mine.side as string, action: 'error', msg: `Close failed: ${String(e)}` }); }
      }

      // ── Partial close: trader reduced position by ≥30% ─────────────────────
      for (const sym of Array.from(knownRef.current) as string[]) {
        const traderPos  = trMap.get(sym);
        const prevAmount = amountRef.current.get(sym);
        const mine       = myMap.get(sym);
        if (!traderPos || !prevAmount || !mine) continue;

        const currentAmount = Number(traderPos.amount);
        const reductionPct  = (prevAmount - currentAmount) / prevAmount;

        // Only act if trader reduced by ≥30% and we haven't already closed our share
        if (reductionPct < 0.30) continue;

        // How much of our position to close proportionally
        const myAmount     = Number(mine.amount);
        const closeAmount  = myAmount * reductionPct;
        const mkt          = markets.find(m => m.symbol === sym);
        const lot          = mkt?.lot_size ? Number(mkt.lot_size) : 0.0001;
        const dec          = Math.max(0, Math.ceil(-Math.log10(lot)));
        const minSize      = mkt?.min_order_size ? Number(mkt.min_order_size) : 0;

        if (closeAmount < minSize) {
          log({ symbol: sym, side: mine.side as string, action: 'skipped', msg: `Partial close skipped — amount too small (${closeAmount.toFixed(dec)})` });
          amountRef.current.set(sym, currentAmount); // update so we don't re-trigger
          continue;
        }

        amountRef.current.set(sym, currentAmount); // update before order to prevent double-trigger

        try {
          const { buildSigningPayload, buildRequestBody } = await import('@/lib/pacificaSigning');
          const data: Record<string,unknown> = {
            symbol: sym,
            amount: closeAmount.toFixed(dec),
            side: mine.side === 'bid' ? 'ask' : 'bid',
            reduce_only: true, slippage_percent: '1',
            client_order_id: crypto.randomUUID(),
          };
          const { payload, timestamp } = buildSigningPayload('create_market_order', data);
          const sig  = await agentSign(cfg.agentPrivateKey, new TextEncoder().encode(payload));
          const body = { ...buildRequestBody(myAccount as string, sig, timestamp, data), agent_wallet: cfg.agentPublicKey };
          const res  = await fetch('https://api.pacifica.fi/api/v1/orders/create_market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const json = await res.json();
          if (json.success) {
            log({ symbol: sym, side: mine.side as string, action: 'closed',
              msg: `Partial close: trader reduced ${(reductionPct*100).toFixed(0)}% → closed ${closeAmount.toFixed(dec)} of our position` });
            onToast(`Copy Trade: ${sym} partially closed (${(reductionPct*100).toFixed(0)}%)`, 'info');
          } else {
            log({ symbol: sym, side: mine.side as string, action: 'error', msg: `Partial close failed: ${json.error || JSON.stringify(json)}` });
          }
        } catch (e) { log({ symbol: sym, side: mine.side as string, action: 'error', msg: `Partial close error: ${String(e)}` }); }
      }

    } catch (e) {
      log({ symbol: '—', side: '—', action: 'error', msg: `Poll error: ${String(e)}` });
    } finally { setRunning(false); }
  }, [cfg, traderAccount, myAccount, tickers, markets, onToast]);

  // Keep pollFnRef always pointing to the latest poll function.
  // This lets the interval call the latest version without restarting on every tickers update.
  useEffect(() => { pollFnRef.current = poll; }, [poll]);

  // Start / stop engine.
  // NOTE: `poll` is intentionally NOT in the dependency array here.
  // The interval calls pollFnRef.current() so it always uses the latest poll
  // without restarting the interval every time tickers or markets change.
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (cfg.active && cfg.agentPrivateKey && cfg.agentPublicKey && myAccount) {
      // Only reset snapshot if we have no persisted known symbols
      if (knownRef.current.size === 0) {
        firstPollRef.current = true;
      }
      amountRef.current.clear();
      // Fire immediately, then every 10s — use ref so interval never restarts on tickers change
      pollFnRef.current?.();
      timerRef.current = setInterval(() => pollFnRef.current?.(), 10_000);
    } else if (!cfg.active) {
      // Clear persisted known when user manually stops, so next start is a fresh snapshot
      clearKnown(traderAccount);
      knownRef.current.clear();
      amountRef.current.clear();
      firstPollRef.current = true;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.active, cfg.agentPrivateKey, cfg.agentPublicKey, myAccount, traderAccount]);

  const pkValid  = isValidBase58(cfg.agentPrivateKey, 88);
  const pubValid = isValidBase58(cfg.agentPublicKey, 44);

  // Derive public key from private key and check it matches what the user entered
  const derivedPubKey = (() => {
    if (!pkValid) return null;
    try {
      const raw = fromB58(cfg.agentPrivateKey);
      const seed = raw.length === 64 ? raw.slice(0, 32) : raw;
      const kp = nacl.sign.keyPair.fromSeed(seed);
      // toBase58 the pubkey
      const B58A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const bytes = kp.publicKey;
      let lz = 0; for (let i = 0; i < bytes.length; i++) { if (bytes[i] === 0) lz++; else break; }
      const digits = [0];
      for (let bi = 0; bi < bytes.length; bi++) {
        let carry = bytes[bi];
        for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
        while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
      }
      while (digits.length > 1 && digits[digits.length - 1] === 0) digits.pop();
      return '1'.repeat(lz) + digits.reverse().map((d: number) => B58A[d]).join('');
    } catch { return null; }
  })();

  const pubKeyMismatch = pkValid && pubValid && derivedPubKey !== null && derivedPubKey !== cfg.agentPublicKey;
  const canStart = pkValid && pubValid && !!myAccount && !pubKeyMismatch;

  return (
    <div className="border-t border-border1 bg-surface2/30">
      {/* Status bar */}
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${cfg.active ? 'bg-success animate-pulse' : 'bg-border2'}`} />
          <span className="text-[11px] font-bold text-text1">Copy Trade</span>
          {cfg.active && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/25">ACTIVE</span>}
        </div>
        <div className="flex items-center gap-2">
          {lastPoll && cfg.active && <span className="text-[9px] text-text3 font-mono">{lastPoll.toLocaleTimeString()}</span>}
          {running && <div className="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" />}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">

        {/* API Agent Keys */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold text-text3 uppercase tracking-wide">API Agent Keys</span>
            <button onClick={() => setShowHelp(v => !v)} className="text-[9px] text-accent hover:underline">
              {showHelp ? 'Hide' : 'How to get?'}
            </button>
          </div>
          {showHelp && (
            <div className="px-3 py-2 bg-accent/5 border border-accent/20 rounded-xl text-[9px] text-text2 space-y-1 leading-relaxed">
              <p className="font-semibold text-accent">How to get API Agent Keys</p>
              <p>1. Go to <a href="https://app.pacifica.fi/apikey" target="_blank" rel="noopener noreferrer" className="text-accent underline">app.pacifica.fi/apikey</a></p>
              <p>2. Click &quot;Generate API Agent Key&quot; and copy both keys</p>
              <p>3. Paste them below — saved only in your browser&apos;s local storage</p>
              <p className="text-warn">⚠ Never share your private key with anyone.</p>
            </div>
          )}
          <input type="password" placeholder="Agent Private Key (Base58)"
            value={cfg.agentPrivateKey}
            onChange={e => setCfg(p => ({ ...p, agentPrivateKey: e.target.value.trim() }))}
            className={`w-full bg-surface border rounded-xl px-3 py-2 text-[10px] font-mono text-text1 outline-none focus:border-accent/60 placeholder-text3 transition-colors ${
              cfg.agentPrivateKey && !pkValid ? 'border-danger/60 bg-danger/5' : 'border-border1'
            }`} />
          {cfg.agentPrivateKey && !pkValid && (
            <p className="text-[9px] text-danger px-1">⚠ Geçersiz Private Key — Base58 formatında ~88 karakter olmalı</p>
          )}
          <input type="text" placeholder="Agent Public Key (Base58)"
            value={cfg.agentPublicKey}
            onChange={e => setCfg(p => ({ ...p, agentPublicKey: e.target.value.trim() }))}
            className={`w-full bg-surface border rounded-xl px-3 py-2 text-[10px] font-mono text-text1 outline-none focus:border-accent/60 placeholder-text3 transition-colors ${
              cfg.agentPublicKey && !pubValid ? 'border-danger/60 bg-danger/5' : 'border-border1'
            }`} />
          {cfg.agentPublicKey && !pubValid && (
            <p className="text-[9px] text-danger px-1">⚠ Geçersiz Public Key — Base58 formatında ~44 karakter olmalı</p>
          )}
          {cfg.agentPrivateKey && pkValid && cfg.agentPublicKey && pubValid && !pubKeyMismatch && (
            <p className="text-[9px] text-success px-1">✓ API Agent Keys geçerli görünüyor</p>
          )}
          {pubKeyMismatch && (
            <p className="text-[9px] text-danger px-1">
              ✗ Public key private key ile eşleşmiyor! Pacifica UI'dan her iki key'i yeniden kopyalayın.
              {derivedPubKey && <span className="block font-mono opacity-70">Beklenen: {derivedPubKey}</span>}
            </p>
          )}
        </div>

        {/* Leverage mode */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-semibold text-text3 uppercase tracking-wide">Leverage</span>
          <div className="flex bg-surface border border-border1 rounded-xl overflow-hidden">
            {(['mirror','custom'] as const).map(m => (
              <button key={m} onClick={() => setCfg(p => ({ ...p, leverageMode: m }))}
                className={`flex-1 py-1.5 text-[11px] font-semibold transition-all ${cfg.leverageMode === m ? 'bg-accent text-white' : 'text-text3 hover:text-text2'}`}>
                {m === 'mirror' ? 'Mirror Trader' : 'Custom'}
              </button>
            ))}
          </div>
          {cfg.leverageMode === 'mirror'
            ? <p className="text-[9px] text-text3 px-1">Uses the trader&apos;s actual leverage per symbol, capped at each market&apos;s maximum.</p>
            : <div className="flex items-center gap-2">
                <input type="number" min={1} max={50} value={cfg.customLeverage}
                  onChange={e => setCfg(p => ({ ...p, customLeverage: Math.max(1, Math.min(50, Number(e.target.value))) }))}
                  className="w-20 bg-surface border border-border1 rounded-xl px-3 py-2 text-[12px] font-mono text-text1 outline-none focus:border-accent/60 transition-colors" />
                <span className="text-[11px] text-text3 font-semibold">× (capped at market max)</span>
              </div>
          }
        </div>

        {/* Margin + Max positions */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <label className="text-[9px] font-semibold text-text3 uppercase tracking-wide">Margin / Trade</label>
              <span className="relative inline-flex items-center group">
                <span className="w-3 h-3 rounded-full border border-border2 text-text3 flex items-center justify-center text-[7px] font-bold cursor-help">?</span>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-44 bg-surface border border-border1 rounded-lg px-2 py-1.5 text-[10px] text-text2 leading-relaxed shadow-card-md z-[200] pointer-events-none whitespace-normal hidden group-hover:block">
                  Minimum is $10. Your margin per trade — position size = Margin × Leverage.
                </span>
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text3">$</span>
              <input type="number" min={10} value={cfg.marginUsd}
                onChange={e => setCfg(p => ({ ...p, marginUsd: Math.max(10, Number(e.target.value)) }))}
                className="w-full bg-surface border border-border1 rounded-xl pl-5 pr-3 py-2 text-[12px] font-mono text-text1 outline-none focus:border-accent/60 transition-colors" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-semibold text-text3 uppercase tracking-wide">Max Positions <span className="font-normal">(0 = ∞)</span></label>
            <input type="number" min={0} max={20} value={cfg.maxPositions}
              onChange={e => setCfg(p => ({ ...p, maxPositions: Number(e.target.value) }))}
              className="w-full bg-surface border border-border1 rounded-xl px-3 py-2 text-[12px] font-mono text-text1 outline-none focus:border-accent/60 transition-colors" />
          </div>
        </div>

        {/* SL / TP */}
        <div className="grid grid-cols-2 gap-2">
          {/* Stop Loss */}
          <div className={`border rounded-xl p-2.5 transition-all ${cfg.slEnabled ? 'border-danger/40 bg-danger/5' : 'border-border1'}`}>
            <button onClick={() => setCfg(p => ({ ...p, slEnabled: !p.slEnabled }))}
              className={`flex items-center gap-1.5 text-[10px] font-semibold mb-1.5 ${cfg.slEnabled ? 'text-danger' : 'text-text3'}`}>
              <div className={`relative w-6 h-3.5 rounded-full transition-all ${cfg.slEnabled ? 'bg-danger' : 'bg-border2'}`}>
                <span className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${cfg.slEnabled ? 'translate-x-2.5' : ''}`} />
              </div>
              Stop Loss
            </button>
            {cfg.slEnabled
              ? <><div className="flex justify-between text-[9px] mb-1"><span className="text-text3">Trigger</span><span className="font-bold text-danger">{cfg.slPct}%</span></div>
                  <input type="range" min={0.5} max={50} step={0.5} value={cfg.slPct} onChange={e => setCfg(p => ({ ...p, slPct: Number(e.target.value) }))} className="w-full accent-danger cursor-pointer h-1" /></>
              : <div className="text-[9px] text-text3">Off</div>
            }
          </div>
          {/* Take Profit */}
          <div className={`border rounded-xl p-2.5 transition-all ${cfg.tpEnabled ? 'border-success/40 bg-success/5' : 'border-border1'}`}>
            <button onClick={() => setCfg(p => ({ ...p, tpEnabled: !p.tpEnabled }))}
              className={`flex items-center gap-1.5 text-[10px] font-semibold mb-1.5 ${cfg.tpEnabled ? 'text-success' : 'text-text3'}`}>
              <div className={`relative w-6 h-3.5 rounded-full transition-all ${cfg.tpEnabled ? 'bg-success' : 'bg-border2'}`}>
                <span className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${cfg.tpEnabled ? 'translate-x-2.5' : ''}`} />
              </div>
              Take Profit
            </button>
            {cfg.tpEnabled
              ? <><div className="flex justify-between text-[9px] mb-1"><span className="text-text3">Target</span><span className="font-bold text-success">{cfg.tpPct}%</span></div>
                  <input type="range" min={1} max={200} step={1} value={cfg.tpPct} onChange={e => setCfg(p => ({ ...p, tpPct: Number(e.target.value) }))} className="w-full accent-success cursor-pointer h-1" /></>
              : <div className="text-[9px] text-text3">Off</div>
            }
          </div>
        </div>

        {/* Activate / Deactivate */}
        <button disabled={!canStart}
          onClick={() => canStart && setCfg(p => ({ ...p, active: !p.active }))}
          className={`w-full py-2.5 rounded-xl font-bold text-[12px] flex items-center justify-center gap-2 transition-all border ${
            cfg.active
              ? 'bg-danger/10 text-danger border-danger/30 hover:bg-danger/20'
              : canStart
                ? 'bg-success/10 text-success border-success/30 hover:bg-success/20'
                : 'opacity-40 cursor-not-allowed bg-surface2 text-text3 border-border1'
          }`}>
          {cfg.active
            ? <><div className="w-2 h-2 rounded-full bg-danger animate-pulse" /> Stop Copy Trade</>
            : <>{canStart ? 'Start Copy Trade' : (cfg.agentPrivateKey || cfg.agentPublicKey) && (!pkValid || !pubValid) ? 'Geçersiz Key formatı' : 'Enter Agent Keys to activate'}</>
          }
        </button>

        {/* Running status */}
        {cfg.active && myPosCount > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-warn/5 border border-warn/20 rounded-xl text-[9px]">
            <span className="flex items-center gap-1.5 text-warn">
              ⚠ Stopping will NOT close your {myPosCount} open position(s) automatically
            </span>
          </div>
        )}
        {cfg.active && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-success/5 border border-success/20 rounded-xl text-[9px]">
            <span className="flex items-center gap-1.5 text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
              Polling every 10s · {myPosCount} open position(s)
            </span>
            <span className="text-text3">Keep browser open</span>
          </div>
        )}

        {/* Builder code notice */}
        <p className="text-[9px] text-text3 text-center">
          Builder code <span className="font-mono text-accent">PACIFICALENS</span> applied to all orders
        </p>

        {/* Activity log */}
        {logs.length > 0 && (
          <div>
            <button onClick={() => setShowLogs(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-surface border border-border1 rounded-xl text-[10px] font-semibold text-text2 hover:border-accent/30 transition-colors">
              <span className="flex items-center gap-1.5">
                Activity Log
                <span className="bg-accent/20 text-accent text-[8px] font-bold px-1.5 py-0.5 rounded-full">{logs.length}</span>
              </span>
              <span className="text-[8px] text-text3">{showLogs ? '▲ Hide' : '▼ Show'}</span>
            </button>
            {showLogs && (
              <div className="mt-1.5 max-h-44 overflow-y-auto space-y-1">
                {logs.map(l => (
                  <div key={l.id} className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-[9px] ${
                    l.action === 'opened'  ? 'bg-success/5 border-success/20 text-success' :
                    l.action === 'closed'  ? 'bg-accent/5  border-accent/20  text-accent'  :
                    l.action === 'error'   ? 'bg-danger/5  border-danger/20  text-danger'  :
                    'bg-surface2 border-border1 text-text3'}`}>
                    <span className="shrink-0 font-bold">{l.action==='opened'?'↑':l.action==='closed'?'↓':l.action==='error'?'✗':'–'}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {l.symbol !== '—' && <span className="font-bold">{l.symbol}</span>}
                        <span className="opacity-60 font-mono">{new Date(l.ts).toLocaleTimeString()}</span>
                      </div>
                      <div className="opacity-90 break-words">{l.msg}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Favorite Card ────────────────────────────────────────────────────────────

function FavoriteCard({
  fav, lbEntry, score, trades, tradesLoading, tickers, markets, myAccount,
  onRemove, onCopyTrade, onRefreshTrades, onToast,
}: {
  fav: FavoriteTrader;
  lbEntry?: LeaderboardEntry;
  score?: import('@/lib/traderScore').TraderScore | null;
  trades: TraderTrade[];
  tradesLoading: boolean;
  tickers: Record<string, Ticker>;
  markets: Market[];
  myAccount: string | null;
  onRemove: () => void;
  onCopyTrade: (trade: TraderTrade) => void;
  onRefreshTrades: () => void;
  onToast: (msg: string, type: 'success'|'error'|'info') => void;
}) {
  const [expanded, setExpanded]         = useState(false);
  const [showCopyTrade, setShowCopyTrade] = useState(false);

  const isCTActive = !!loadCT()[fav.account]?.active;

  return (
    <div className="border border-border1 rounded-2xl bg-surface overflow-hidden shadow-card">

      {/* Header row */}
      <div className="px-4 py-3 flex items-center gap-3">

        {/* Left: address + stats — click to expand */}
        <div className="flex-1 min-w-0 cursor-pointer select-none" onClick={() => setExpanded(v => !v)}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
              {fav.account.slice(0,2).toUpperCase()}
            </div>
            <span className="text-[12px] font-mono text-text1 font-semibold">{fmtShortAddr(fav.account)}</span>
            {score && <ScoreBadge score={score} />}
            {isCTActive && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/20 flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-success animate-pulse inline-block" />
                Copying
              </span>
            )}
          </div>
          {lbEntry && (
            <div className="flex items-center gap-3 mt-1">
              <span className={`text-[10px] font-semibold ${lbEntry.pnl_30d >= 0 ? 'text-success' : 'text-danger'}`}>
                PnL 30d: {fmtN(lbEntry.pnl_30d, true)}
              </span>
              <span className="text-[10px] text-text3">Vol: {fmtN(lbEntry.volume_30d)}</span>
            </div>
          )}
        </div>

        {/* Copy Trade button */}
        <button
          onClick={e => { e.stopPropagation(); setShowCopyTrade(v => !v); }}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
            showCopyTrade || isCTActive
              ? 'bg-success/10 text-success border-success/30'
              : 'bg-surface2 text-text3 border-border1 hover:border-success/40 hover:text-success'
          }`}>
          {isCTActive && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
          Copy Trade
        </button>

        {/* Remove */}
        <button onClick={e => { e.stopPropagation(); onRemove(); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text3 hover:text-danger hover:bg-danger/5 transition-all text-[14px]">×</button>

        {/* Expand chevron */}
        <span className={`text-text3 text-[10px] transition-transform cursor-pointer select-none ${expanded ? 'rotate-180' : ''}`}
          onClick={() => setExpanded(v => !v)}>▾</span>
      </div>

      {/* Copy Trade Panel — inline, below header */}
      {showCopyTrade && (
        <CopyTradePanel
          traderAccount={fav.account}
          myAccount={myAccount}
          markets={markets}
          tickers={tickers}
          onToast={onToast}
        />
      )}

      {/* Expanded: recent trades */}
      {expanded && (
        <div className="border-t border-border1">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-text3 uppercase font-semibold tracking-wide">Recent Trades</span>
              <button onClick={onRefreshTrades} className="text-[10px] text-accent hover:underline flex items-center gap-1">↻ Refresh</button>
            </div>
            {tradesLoading ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <div className="w-4 h-4 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-[11px] text-text3">Loading trades...</span>
              </div>
            ) : trades.length === 0 ? (
              <div className="text-center py-6 text-[12px] text-text3">No recent trades found</div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {trades.map((t, i) => {
                  const { label, isLong } = sideLabel(t.side);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const pnl = Number((t as any).pnl ?? t.realized_pnl ?? 0);
                  const isOpenTrade = t.side?.includes('open') || t.side === 'bid' || t.side === 'ask' || t.side?.includes('long') || t.side?.includes('short');
                  return (
                    <div key={t.id || i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface2 border border-border1 hover:border-border2 transition-colors group">
                      <CoinLogo symbol={t.symbol} size={24} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-text1">{t.symbol}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>{label}</span>
                        </div>
                        <div className="text-[10px] text-text3 font-mono">${fmtPrice(t.price)} · {fmt(Number(t.amount), 4)} · {fmtTime(t.created_at)}</div>
                      </div>
                      {pnl !== 0 && (
                        <span className={`text-[11px] font-semibold font-mono ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                          {pnl >= 0 ? '+' : ''}{fmtN(pnl)}
                        </span>
                      )}
                      {isOpenTrade && (
                        <button onClick={() => onCopyTrade(t)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-accent text-white text-[10px] font-bold px-2.5 py-1 rounded-lg hover:bg-accent/90 shrink-0">
                          Copy
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

interface CopyTradingProps {
  markets: Market[];
  tickers: Record<string, Ticker>;
  wallet: string | null;
  accountInfo: AccountInfo | null;
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  ensureBuilderApproved: () => Promise<boolean>;
  walletSignFn: (msgBytes: Uint8Array) => Promise<string>;
}

export function CopyTrading({ markets, tickers, wallet, accountInfo, onToast, ensureBuilderApproved, walletSignFn }: CopyTradingProps) {

  const { getScore, loading: scoresLoading, refreshScores, computedAt: scoresComputedAt } = useTraderScore();

  const {
    leaderboard,
    lbLoading, lbError, fetchLeaderboard,
    sortField, sortDir, toggleSort,
    searchQuery, setSearchQuery,
    page, setPage, totalPages, pagedList, globalStart, filteredTotal,
    favorites, isFavorite, toggleFavorite, updateFavorite, removeFavorite,
    traderTrades, tradesLoading, fetchTraderTrades,
    
  } = useCopyTrading();

  const [activeTab, setActiveTab] = useState<'leaderboard' | 'favorites'>('leaderboard');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    minPnl7d: '', minPnl30d: '', minPnlAll: '',
    minVolume: '', minEquity: '',
    onlyProfitable: false,
  });
  const [copyModal, setCopyModal] = useState<{ trade: TraderTrade; traderAddress: string; fav?: FavoriteTrader } | null>(null);
  const [selectedTrader, setSelectedTrader] = useState<string | null>(null);
  const [drawerAccount, setDrawerAccount] = useState<import('@/lib/pacifica').AccountInfo | null>(null);
  const [drawerPositions, setDrawerPositions] = useState<import('@/lib/pacifica').Position[]>([]);
  const [drawerEquityHist, setDrawerEquityHist] = useState<import('@/lib/pacifica').EquityHistory[]>([]);
  const [drawerTradeHist, setDrawerTradeHist] = useState<import('@/lib/pacifica').TradeHistory[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerPortfolio, setDrawerPortfolio] = useState<PortfolioStats | null>(null);
  const [drawerTab, setDrawerTab] = useState<'positions' | 'open_orders' | 'trade_history'>('positions');
  const [drawerSort, setDrawerSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: '', dir: 'desc' });
  // Auto panel: which position is showing the auto settings
  function toggleDrawerSort(key: string) {
    setDrawerSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }
  function sortDrawer<T>(arr: T[], getter: (item: T) => number | string): T[] {
    if (!drawerSort.key) return arr;
    return [...arr].sort((a, b) => {
      const va = getter(a), vb = getter(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return drawerSort.dir === 'asc' ? cmp : -cmp;
    });
  }

  const [drawerOpenOrders, setDrawerOpenOrders] = useState<import('@/lib/pacifica').OpenOrder[]>([]);
  const [drawerOrderHistory, setDrawerOrderHistory] = useState<import('@/lib/pacifica').OpenOrder[]>([]);
  const [drawerFundingHistory, setDrawerFundingHistory] = useState<import('@/lib/pacifica').FundingHistory[]>([]);

  // O(1) lookup map for leaderboard entries by address
  const leaderboardMap = new Map<string, LeaderboardEntry>(leaderboard.map(e => [e.account, e]));

  // Apply filters to FULL leaderboard first, then slice for current page
  const hasActiveFilters = Object.values(filters).some(v => v !== '' && v !== false);
  const filteredLeaderboard = hasActiveFilters ? leaderboard.filter(e => {
    if (filters.minPnl7d && e.pnl_7d < Number(filters.minPnl7d)) return false;
    if (filters.minPnl30d && e.pnl_30d < Number(filters.minPnl30d)) return false;
    if (filters.minPnlAll && e.pnl_all < Number(filters.minPnlAll)) return false;
    if (filters.minVolume && e.volume_30d < Number(filters.minVolume)) return false;
    if (filters.minEquity && e.equity_current < Number(filters.minEquity)) return false;
    if (filters.onlyProfitable && e.pnl_30d <= 0) return false;
    return true;
  }) : pagedList;

  // Score-aware sort override: when sortField === 'score', 'watching', or 'style', re-sort using live data
  const scoreSortedList = (() => {
    if (sortField !== 'score' && sortField !== 'watching' && sortField !== 'style') return null;
    return [...leaderboard]
      .filter(e => !searchQuery.trim() || e.account.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      .sort((a, b) => {
        if (sortField === 'watching') {
          const wa = isFavorite(a.account) ? 1 : 0;
          const wb = isFavorite(b.account) ? 1 : 0;
          return sortDir === 'desc' ? wb - wa : wa - wb;
        }
        if (sortField === 'style') {
          const sa = getScore(a.account)?.style ?? '';
          const sb = getScore(b.account)?.style ?? '';
          return sortDir === 'desc' ? sb.localeCompare(sa) : sa.localeCompare(sb);
        }
        const sa = getScore(a.account)?.score ?? -1;
        const sb = getScore(b.account)?.score ?? -1;
        return sortDir === 'desc' ? sb - sa : sa - sb;
      });
  })();

  // When filters active: paginate filtered full list; otherwise use hook's pagedList
  const PAGE_SIZE_FILTER = 50;
  const filteredTotalPages = hasActiveFilters ? Math.ceil(filteredLeaderboard.length / PAGE_SIZE_FILTER) : totalPages;

  // When score sort: use scoreSortedList; when other filters: use filteredLeaderboard; else hook's pagedList
  const activeList = scoreSortedList ?? (hasActiveFilters ? filteredLeaderboard : null);
  const filteredPagedList = activeList
    ? activeList.filter(e => {
        if (!hasActiveFilters) return true;
        if (filters.minPnl7d && e.pnl_7d < Number(filters.minPnl7d)) return false;
        if (filters.minPnl30d && e.pnl_30d < Number(filters.minPnl30d)) return false;
        if (filters.minPnlAll && e.pnl_all < Number(filters.minPnlAll)) return false;
        if (filters.minVolume && e.volume_30d < Number(filters.minVolume)) return false;
        if (filters.minEquity && e.equity_current < Number(filters.minEquity)) return false;
        if (filters.onlyProfitable && e.pnl_30d <= 0) return false;
        return true;
      }).slice(page * PAGE_SIZE_FILTER, (page + 1) * PAGE_SIZE_FILTER)
    : pagedList;

  const myBalance = accountInfo ? Number(accountInfo.available_to_spend || accountInfo.balance || 0) : 0;
  const { addEntry, updateEntry } = useOrderLog(wallet);

  // Position mirroring

  // walletSignFn is provided by AppShell — uses Privy's wallet to sign


  // ── Open trader drawer ───────────────────────────────────────────────────
  async function openTraderDrawer(account: string) {
    setSelectedTrader(account);
    setDrawerTab('positions');
    setDrawerLoading(true);
    setDrawerAccount(null);
    setDrawerPositions([]);
    setDrawerEquityHist([]);
    setDrawerTradeHist([]);
    setDrawerPortfolio(null);
    setDrawerOpenOrders([]);
    setDrawerOrderHistory([]);
    setDrawerFundingHistory([]);
    const [acct, pos, eq, trades, allOrders] = await Promise.all([
      getAccountInfo(account),
      getPositions(account),
      getEquityHistory(account),
      getTradesHistory(account, 50),
      getOrderHistory(account, 100),
    ]);
    const portfolio = null; // portfolio endpoint not available for other accounts
    setDrawerAccount(acct);
    setDrawerPositions(pos);
    setDrawerEquityHist(eq);
    setDrawerTradeHist(trades);
    setDrawerPortfolio(null); // portfolio endpoint unavailable
    // Open orders = order_status === 'open' from orders/history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setDrawerOpenOrders(allOrders.filter((o: any) => (o.order_status ?? o.status) === 'open'));
    setDrawerOrderHistory([]);
    setDrawerFundingHistory([]);
    setDrawerLoading(false);
  }


  // ── Manual copy handler ───────────────────────────────────────────────────

  async function handleManualCopy(
    trade: TraderTrade,
    traderAddress: string,
    amount: number,
    leverage: number,
    orderType: 'market' | 'limit',
    limitPrice?: string,
    slPrice?: number | null,
    tpPrice?: number | null,
  ) {
    if (!wallet) { onToast('Connect your wallet first', 'error'); return; }
    const approved = await ensureBuilderApproved();
    if (!approved) return;

    const market = markets.find(m => m.symbol === trade.symbol);
    const { isLong } = sideLabel(trade.side);
    const tk = tickers[trade.symbol];
    const markPrice = getMarkPrice(tk);
    const entryPrice = orderType === 'market' ? markPrice : (Number(limitPrice) || markPrice);
    const contracts = entryPrice > 0 ? (amount * leverage) / entryPrice : 0;
    const decimals = market?.lot_size
      ? Math.max(0, Math.ceil(-Math.log10(Number(market.lot_size))))
      : 4;

    // Log order
    const logId = addEntry({
      symbol: trade.symbol,
      side: isLong ? 'bid' : 'ask',
      amount: contracts.toFixed(decimals),
      price: String(entryPrice.toFixed(4)),
      orderType,
      status: 'pending',
      source: 'copy',
      traderAddress,
    });

    const slTpStr = [slPrice ? `SL $${slPrice.toFixed(2)}` : null, tpPrice ? `TP $${tpPrice.toFixed(2)}` : null].filter(Boolean).join(' · ');
    onToast(`Placing ${isLong ? 'LONG' : 'SHORT'} ${trade.symbol} ${leverage}×${slTpStr ? ' · ' + slTpStr : ''}...`, 'info');

    try {
      onToast('Waiting for wallet signature...', 'info');
      const signFn = walletSignFn;

      // Set leverage for this symbol before placing the order
      if (leverage && leverage > 0) {
        const levResult = await updateLeverage(wallet, trade.symbol, leverage, signFn);
        if (!levResult.success) {
          onToast(`Leverage update failed: ${levResult.error}`, 'error');
          throw new Error(levResult.error);
        }
      }

      let result;

      if (orderType === 'market') {
        result = await submitMarketOrder(wallet, {
          symbol: trade.symbol,
          amount: contracts.toFixed(decimals),
          side: isLong ? 'bid' : 'ask',
          reduce_only: false,
          slippage_percent: '1',
          ...(slPrice ? { stop_loss: { stop_price: roundToTick(slPrice, market?.tick_size || '0.01') } } : {}),
          ...(tpPrice ? { take_profit: { stop_price: roundToTick(tpPrice, market?.tick_size || '0.01') } } : {}),
        }, signFn);
      } else {
        result = await submitLimitOrder(wallet, {
          symbol: trade.symbol,
          price: limitPrice || String(markPrice),
          amount: contracts.toFixed(decimals),
          side: isLong ? 'bid' : 'ask',
          tif: 'GTC',
          reduce_only: false,
          ...(slPrice ? { stop_loss: { stop_price: roundToTick(slPrice, market?.tick_size || '0.01') } } : {}),
          ...(tpPrice ? { take_profit: { stop_price: roundToTick(tpPrice, market?.tick_size || '0.01') } } : {}),
        }, signFn);
      }

      if (result.success) {
        updateEntry(logId, { status: 'success', orderId: result.orderId });
        onToast(`✓ ${trade.symbol} ${isLong ? 'Long' : 'Short'} placed!`, 'success');
      } else {
        updateEntry(logId, { status: 'failed', error: result.error });
        onToast(`Order error: ${result.error}`, 'error');
        throw new Error(result.error); // propagate so modal stays open
      }
    } catch (e) {
      onToast(`Error: ${String(e)}`, 'error');
    }
  }

  // ─── Sort columns config ──────────────────────────────────────────────────

  const sortCols: { label: string; field: SortField }[] = [
    { label: 'Score', field: 'score' },
    { label: 'PnL 7D', field: 'pnl_7d' },
    { label: 'PnL 30D', field: 'pnl_30d' },
    { label: 'PnL All Time', field: 'pnl_all' },
    { label: 'Vol 7D', field: 'volume_7d' },
    { label: 'Vol 30D', field: 'volume_30d' },
    { label: 'Vol All Time', field: 'volume_all' },
    { label: 'Equity', field: 'equity_current' },
    { label: 'Open Int.', field: 'oi_current' },
    { label: 'Style', field: 'style' },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  // ── Mini sparkline for equity history ────────────────────────────────────
  function Sparkline({ data }: { data: { equity: string }[] }) {
    if (!data.length) return <div className="h-10 text-[10px] text-text3 flex items-center">No data</div>;
    const vals = data.map(d => Number(d.equity));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const w = 280, h = 48;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
    const isUp = vals[vals.length - 1] >= vals[0];
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        <polyline points={pts} fill="none" stroke={isUp ? 'var(--success)' : 'var(--danger)'} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ─── LEFT: Info Sidebar ─── */}
      <div className="w-52 shrink-0 border-r border-border1 bg-surface flex flex-col overflow-y-auto">
        <div className="px-3 py-3 border-b border-border1">
          <div className="text-[10px] font-bold text-text3 uppercase tracking-wider">Smart Money</div>
        </div>

        {activeTab === 'leaderboard' ? (
          <div className="flex-1 px-3 py-4 space-y-4 text-[11px]">
            <div>
              <div className="font-bold text-text1 mb-1">📊 Leaderboard</div>
              <div className="text-text3 leading-relaxed text-[10px]">
                Top traders on Pacifica ranked by our scoring system. Each trader is evaluated across 8 dimensions of trading quality.
              </div>
            </div>
            <div className="border-t border-border1 pt-3">
              <div className="font-semibold text-text2 mb-2 text-[10px] uppercase tracking-wide">Score Breakdown</div>
              <div className="space-y-1.5 text-[10px] text-text3">
                <div><span className="text-text2 font-semibold">PnL (20pts)</span> — Raw profit performance over 7d and 30d</div>
                <div><span className="text-text2 font-semibold">Consistency (20pts)</span> — Steady gains vs erratic spikes</div>
                <div><span className="text-text2 font-semibold">EPR (15pts)</span> — Profit relative to open interest</div>
                <div><span className="text-text2 font-semibold">Win Rate (15pts)</span> — Long-term profitability ratio</div>
                <div><span className="text-text2 font-semibold">Drawdown (10pts)</span> — Loss control quality</div>
                <div><span className="text-text2 font-semibold">OI Risk (5pts)</span> — Leverage safety score</div>
                <div><span className="text-text2 font-semibold">Track Record (10pts)</span> — All-time performance history</div>
                <div><span className="text-text2 font-semibold">Cap. Efficiency (5pts)</span> — PnL vs account size ratio</div>
              </div>
            </div>
            <div className="border-t border-border1 pt-3">
              <div className="font-semibold text-text2 mb-1.5 text-[10px] uppercase tracking-wide">Tiers</div>
              <div className="space-y-1 text-[10px]">
                <div><span className="text-yellow-400 font-bold">S</span> <span className="text-text3">— Elite, Top 5%</span></div>
                <div><span className="text-blue-400 font-bold">A</span> <span className="text-text3">— Strong, Top 20%</span></div>
                <div><span className="text-green-400 font-bold">B</span> <span className="text-text3">— Average, Top 45%</span></div>
                <div><span className="text-text3 font-bold">C</span> <span className="text-text3">— Weak, Bottom 55%</span></div>
              </div>
            </div>
            <div className="border-t border-border1 pt-3 text-[10px] text-text3">
              <div className="font-semibold text-text2 mb-1">💡 How to use</div>
              <div className="leading-relaxed">Click any trader row to view their open positions, trade history, and copy their trades automatically with Pacifica Agent Keys.</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 px-3 py-4 space-y-4 text-[11px]">
            <div>
              <div className="font-bold text-text1 mb-1">⭐ Watching</div>
              <div className="text-text3 leading-relaxed text-[10px]">
                Your personal watchlist of traders you want to monitor. Star any trader on the leaderboard to add them here.
              </div>
            </div>
            <div className="border-t border-border1 pt-3">
              <div className="font-semibold text-text2 mb-2 text-[10px] uppercase tracking-wide">What you can do</div>
              <div className="space-y-2 text-[10px] text-text3">
                <div>⭐ <span className="text-text2">Star traders</span> — click the star icon on any leaderboard row</div>
                <div>👁️ <span className="text-text2">Monitor positions</span> — see their open trades in real time</div>
                <div>📋 <span className="text-text2">Copy trades</span> — replicate their entries automatically</div>
                <div>🔔 <span className="text-text2">Track PnL</span> — follow their 7d and 30d performance</div>
              </div>
            </div>
            <div className="border-t border-border1 pt-3 text-[10px] text-text3">
              <div className="font-semibold text-text2 mb-1">💡 Tip</div>
              <div className="leading-relaxed">Focus on S and A tier traders with consistent PnL and low drawdown scores for the best copy trading results.</div>
            </div>
          </div>
        )}
      </div>

      {/* Main content — shrinks when drawer open */}
      <div className={`flex flex-col overflow-hidden transition-all duration-300 ${selectedTrader ? 'flex-1 min-w-0' : 'flex-1'}`}>

      {/* Top bar — all inside max-w-[1280px] wrapper */}
      <div className="border-b border-border1 bg-surface shrink-0">
        <div className="max-w-[1280px] mx-auto px-6 py-3 flex items-center gap-4">
          {/* Tab switcher */}
          <div className="flex bg-surface2 border border-border1 rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all ${
                activeTab === 'leaderboard' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2'
              }`}>
              Leaderboard
            </button>
            <button
              onClick={() => setActiveTab('favorites')}
              className={`px-4 py-1.5 text-[12px] font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'favorites' ? 'bg-surface text-accent shadow-card border border-border1' : 'text-text3 hover:text-text2'
              }`}>
              Watching
              {favorites.length > 0 && (
                <span className="bg-accent text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {favorites.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'leaderboard' && (
            <>
              {/* Search */}
              <div className="relative flex-1 max-w-64">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text3 text-[12px]">🔍</span>
                <input
                  type="text"
                  placeholder="Search wallet..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
                  className="w-full bg-surface2 border border-border1 rounded-xl pl-8 pr-3 py-1.5 text-[12px] text-text1 outline-none focus:border-accent transition-colors placeholder-text3"
                />
              </div>

              <div className="ml-auto flex items-center gap-3 shrink-0">
                <button onClick={() => setShowFilters(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-semibold transition-all ${
                    showFilters || hasActiveFilters
                      ? 'bg-accent/10 border-accent/30 text-accent'
                      : 'border-border1 text-text3 hover:border-accent/40 hover:text-accent'
                  }`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                  Filter
                  {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                </button>
                <span className="text-[11px] text-text3">
                  {hasActiveFilters
                    ? `${filteredLeaderboard.length.toLocaleString()} / ${leaderboard.length.toLocaleString()} traders`
                    : `${leaderboard.length.toLocaleString()} traders`
                  }
                </span>
                <button onClick={fetchLeaderboard} disabled={lbLoading}
                  className="flex items-center gap-1.5 text-[11px] text-accent hover:underline disabled:opacity-50">
                  {lbLoading
                    ? <><div className="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" /> Loading...</>
                    : <>↻ Refresh</>
                  }
                </button>
                {scoresComputedAt && (
                  <span className="text-[10px] text-text3 border-l border-border1 pl-3">
                    Score: {new Date(scoresComputedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    {' '}
                    <button onClick={refreshScores} disabled={scoresLoading} className="text-accent hover:underline disabled:opacity-50">
                      {scoresLoading ? '...' : '↻'}
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Filter panel */}
        {showFilters && activeTab === 'leaderboard' && (
          <div className="border-t border-border1 bg-surface2">
            <div className="max-w-[1280px] mx-auto px-6 py-3">
              <div className="grid grid-cols-6 gap-3 items-end">
                {[
                  { label: 'Min PnL 7D ($)', key: 'minPnl7d' },
                  { label: 'Min PnL 30D ($)', key: 'minPnl30d' },
                  { label: 'Min PnL All Time ($)', key: 'minPnlAll' },
                  { label: 'Min Vol 30D ($)', key: 'minVolume' },
                  { label: 'Min Equity ($)', key: 'minEquity' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-[10px] text-text3 uppercase font-semibold block mb-1">{f.label}</label>
                    <input type="number" placeholder="0"
                      value={filters[f.key as keyof typeof filters] as string}
                      onChange={e => { setFilters(prev => ({ ...prev, [f.key]: e.target.value })); setPage(0); }}
                      className="w-full bg-surface border border-border1 rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-text1 outline-none focus:border-accent transition-colors" />
                  </div>
                ))}
                <div className="flex flex-col gap-2">
                  <button onClick={() => { setFilters(prev => ({ ...prev, onlyProfitable: !prev.onlyProfitable })); setPage(0); }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
                      filters.onlyProfitable ? 'bg-success/10 border-success/30 text-success' : 'border-border1 text-text3 hover:border-border2'
                    }`}>
                    <div className={`relative w-7 h-4 rounded-full transition-all ${filters.onlyProfitable ? 'bg-success' : 'bg-border2'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${filters.onlyProfitable ? 'translate-x-3' : ''}`} />
                    </div>
                    Profitable only
                  </button>
                  {hasActiveFilters && (
                    <button onClick={() => { setFilters({ minPnl7d: '', minPnl30d: '', minPnlAll: '', minVolume: '', minEquity: '', onlyProfitable: false }); setPage(0); }}
                      className="text-[11px] text-danger hover:underline text-left">
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-bg">
        <div className="w-full max-w-[1280px] mx-auto">

        {/* ── LEADERBOARD TAB ── */}
        {activeTab === 'leaderboard' && (
          <>
            {lbError && (
              <div className="m-4 p-4 bg-danger/5 border border-danger/20 rounded-xl text-[12px] text-danger">
                ⚠ {lbError}
              </div>
            )}

            {lbLoading && !pagedList.length ? (
              <div className="flex items-center justify-center flex-1 h-64 gap-3">
                <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-[12px] text-text3">Loading leaderboard...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-surface2 border-b border-border1 z-10">
                    <tr>
                      <th className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-left w-8">#</th>
                      <th className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-left">Trader</th>
                      {sortCols.map(c => c.field === 'style' ? (
                        <th key={c.field}
                          onClick={() => toggleSort(c.field)}
                          className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-center cursor-pointer hover:text-accent select-none whitespace-nowrap transition-colors">
                          Style
                          <span className={'ml-1 ' + (sortField === 'style' ? 'text-accent' : 'text-border2')}>
                            {sortField === 'style' ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
                          </span>
                        </th>
                      ) : (
                        <Th key={c.field} label={c.label} field={c.field}
                          cur={sortField} dir={sortDir} onClick={() => toggleSort(c.field)} />
                      ))}
                      <th
                        onClick={() => toggleSort('watching' as SortField)}
                        className="px-3 py-2.5 text-[10px] font-semibold text-text3 uppercase tracking-wide text-center cursor-pointer hover:text-accent select-none transition-colors"
                      >
                        Watch
                        <span className={`ml-1 ${sortField === 'watching' ? 'text-accent' : 'text-border2'}`}>
                          {sortField === 'watching' ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPagedList.map((entry: LeaderboardEntry, i: number) => {
                      const rank = globalStart + i + 1;
                      const faved = isFavorite(entry.account);
                      return (
                        <tr key={entry.account}
                          onClick={() => openTraderDrawer(entry.account)}
                          className="border-b border-border1 last:border-0 hover:bg-surface2/60 transition-colors group cursor-pointer">
                          <td className="px-3 py-2 text-[11px] text-text3 font-mono">{rank}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
                                {entry.account.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="text-[12px] font-mono text-text1 font-semibold">{fmtShortAddr(entry.account)}</div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.account); }}
                                  className="text-[9px] text-text3 hover:text-accent transition-colors opacity-0 group-hover:opacity-100">
                                  Copy address
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* Score */}
                          <td className={`px-3 py-2 text-right ${sortField === 'score' ? 'bg-accent/3' : ''}`}>
                            <ScoreBadge score={getScore(entry.account)} />
                          </td>

                          {/* PnL cols */}
                          {(['pnl_7d', 'pnl_30d', 'pnl_all'] as const).map(f => (
                            <td key={f} className={`px-3 py-2 text-right text-[12px] font-mono font-semibold ${
                              entry[f] >= 0 ? 'text-success' : 'text-danger'
                            } ${sortField === f ? 'bg-accent/3' : ''}`}>
                              {fmtN(entry[f], true)}
                            </td>
                          ))}

                          {/* Volume cols */}
                          {(['volume_7d', 'volume_30d', 'volume_all'] as const).map(f => (
                            <td key={f} className={`px-3 py-2 text-right text-[12px] font-mono text-text2 ${
                              sortField === f ? 'bg-accent/3' : ''
                            }`}>
                              {fmtN(entry[f])}
                            </td>
                          ))}

                          {/* Equity */}
                          <td className={`px-3 py-2 text-right text-[12px] font-mono text-text2 ${
                            sortField === 'equity_current' ? 'bg-accent/3' : ''
                          }`}>
                            {fmtN(entry.equity_current)}
                          </td>

                          {/* OI */}
                          <td className={`px-3 py-2 text-right text-[12px] font-mono text-text2 ${
                            sortField === 'oi_current' ? 'bg-accent/3' : ''
                          }`}>
                            {fmtN(entry.oi_current)}
                          </td>

                          {/* Trader Style */}
                          <td className={`px-3 py-2 hidden md:table-cell text-center ${sortField === 'style' ? 'bg-accent/3' : ''}`}>
                            {(() => {
                              const traderScore = getScore(entry.account);
                              if (!traderScore) return <span className="text-[10px] text-text3">—</span>;
                              const meta = STYLE_META[traderScore.style];
                              return (
                                <span className={`inline-flex items-center justify-center gap-1 text-[10px] font-semibold ${meta.color}`} title={meta.desc}>
                                  {meta.icon} {traderScore.style}
                                </span>
                              );
                            })()}
                          </td>

                          {/* Favorite button */}
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleFavorite(entry.account); }}
                              title={faved ? 'Remove from watchlist' : 'Add to watchlist'}
                              className={`w-8 h-8 flex items-center justify-center mx-auto rounded-lg transition-all text-[14px] ${
                                faved
                                  ? 'text-warn bg-warn/10 border border-warn/30 hover:bg-warn/20'
                                  : 'text-text3 hover:text-warn hover:bg-warn/5 border border-transparent hover:border-warn/20'
                              }`}>
                              {faved ? '★' : '☆'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-border1 flex items-center justify-between">
                <span className="text-[11px] text-text3">
                  Page {page + 1} / {totalPages} · {filteredTotal.toLocaleString()} results
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPage(0)} disabled={page === 0}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    «
                  </button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    ‹
                  </button>
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    const p = Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-8 py-1 text-[11px] rounded-lg border transition-all ${
                          p === page
                            ? 'bg-accent text-white border-accent'
                            : 'text-text2 bg-surface2 border-border1 hover:border-accent/40'
                        }`}>
                        {p + 1}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    ›
                  </button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                    className="px-2.5 py-1 text-[11px] text-text2 bg-surface2 border border-border1 rounded-lg hover:border-accent/40 disabled:opacity-30 transition-all">
                    »
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── FAVORITES TAB ── */}
        {activeTab === 'favorites' && (
          <div className="p-4 space-y-3">

            {/* Builder code info banner */}
            <div className="flex items-center gap-3 px-4 py-3 bg-accent/5 border border-accent/20 rounded-xl">
              <span className="text-lg">🔑</span>
              <div>
                <div className="text-[12px] font-semibold text-text1">Builder Code Active</div>
                <div className="text-[10px] text-text3">
                  All copy trades use builder code <span className="font-mono text-accent">PACIFICALENS</span>. No extra approval needed per trade.
                </div>
              </div>
            </div>

            {favorites.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3"></div>
                <div className="text-[14px] font-semibold text-text2 mb-1">No traders in watchlist</div>
                <div className="text-[12px] text-text3">
                  Go to the Leaderboard tab and click ☆ next to any trader to start watching.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {favorites.map(fav => {
                  const lbEntry = leaderboardMap.get(fav.account);
                  return (
                    <FavoriteCard
                      key={fav.account}
                      fav={fav}
                      lbEntry={lbEntry}
                      score={getScore(fav.account)}
                      trades={traderTrades[fav.account] || []}
                      tradesLoading={!!tradesLoading[fav.account]}
                      tickers={tickers}
                      markets={markets}
                      myAccount={wallet}
                      onRemove={() => removeFavorite(fav.account)}
                      onCopyTrade={trade => setCopyModal({ trade, traderAddress: fav.account, fav })}
                      onRefreshTrades={() => fetchTraderTrades(fav.account)}
                      onToast={onToast}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
        </div>{/* end max-w */}
        {/* Copy trade modal */}
        {copyModal && (
          <CopyTradeModal
            trade={copyModal.trade}
            traderAddress={copyModal.traderAddress}
            markets={markets}
            tickers={tickers}
            myBalance={myBalance}
            defaultAmount={copyModal.fav?.copyAmount || 100}
            onConfirm={async (amount, leverage, orderType, limitPrice, sl, tp) => {
              await handleManualCopy(copyModal.trade, copyModal.traderAddress, amount, leverage, orderType, limitPrice, sl, tp);
            }}
            onClose={() => setCopyModal(null)}
          />
        )}
      </div>{/* end main */}

      {/* ── Trader Detail Drawer ────────────────────────────────────────── */}
      {selectedTrader && (() => {
        const lbEntry = leaderboardMap.get(selectedTrader);
        const faved = isFavorite(selectedTrader);
        const isCopyFav = favorites.find(f => f.account === selectedTrader);
        return (
          <div className="w-[540px] shrink-0 border-l border-border1 bg-surface flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="px-4 py-3 border-b border-border1 bg-surface2 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[11px] font-bold text-accent">
                  {selectedTrader.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-text1 font-mono">{fmtShortAddr(selectedTrader)}</div>
                  <button onClick={() => navigator.clipboard.writeText(selectedTrader)}
                    className="text-[10px] text-text3 hover:text-accent transition-colors">
                    Copy address
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleFavorite(selectedTrader)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                    faved
                      ? 'bg-warn/10 text-warn border-warn/30 hover:bg-warn/20'
                      : 'bg-surface text-text3 border-border1 hover:border-accent/40 hover:text-accent'
                  }`}>
                  {faved ? 'Watching' : '☆ Watch'}
                </button>
                <button onClick={() => setSelectedTrader(null)}
                  className="w-7 h-7 flex items-center justify-center text-text3 hover:text-text1 hover:bg-surface rounded-lg transition-colors text-[16px]">
                  ×
                </button>
              </div>
            </div>

            {drawerLoading ? (
              <div className="flex items-center justify-center flex-1 gap-3">
                <div className="w-5 h-5 border-2 border-border2 border-t-accent rounded-full animate-spin" />
                <span className="text-[12px] text-text3">Loading portfolio...</span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">

                {/* ── Top 4 stat cards — 2. fotoğraf layout ── */}
                <div className="p-3 grid grid-cols-2 gap-2 border-b border-border1">
                  {[
                    { label: 'Account Equity',    value: drawerAccount ? `$${Number(drawerAccount.account_equity).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—', accent: true },
                    { label: 'Available Balance', value: drawerAccount ? `$${Number(drawerAccount.balance).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—' },
                    { label: 'Margin Used',       value: drawerAccount ? `$${Number(drawerAccount.total_margin_used).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—' },
                    { label: 'Open Positions',    value: drawerAccount ? String(drawerAccount.positions_count) : String(drawerPositions.length) },
                  ].map(s => (
                    <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-3 py-2.5">
                      <div className="text-[9px] text-text3 uppercase tracking-wide mb-1">{s.label}</div>
                      <div className={`text-[15px] font-bold ${s.accent ? 'text-accent' : 'text-text1'}`}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* ── Trader Score Card ── */}
                {getScore(selectedTrader!) && (
                  <div className="p-3 border-b border-border1">
                    <ScoreCard score={getScore(selectedTrader!)!} />
                  </div>
                )}

                {/* ── Performance grid — 2. fotoğraf layout ── */}
                {lbEntry && (
                  <div className="p-3 border-b border-border1">
                    <div className="text-[10px] text-text3 uppercase tracking-wide font-semibold mb-2">Performance</div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'PnL 7D',    value: lbEntry.pnl_7d,      isPnl: true },
                        { label: 'PnL 30D',   value: lbEntry.pnl_30d,     isPnl: true },
                        { label: 'PnL All',   value: lbEntry.pnl_all,     isPnl: true },
                        { label: 'Vol 7D',    value: lbEntry.volume_7d,   isPnl: false },
                        { label: 'Vol 30D',   value: lbEntry.volume_30d,  isPnl: false },
                        { label: 'Open Int.', value: lbEntry.oi_current,  isPnl: false },
                      ].map(s => (
                        <div key={s.label} className="bg-surface2 border border-border1 rounded-xl px-2.5 py-2 text-center">
                          <div className="text-[9px] text-text3 uppercase tracking-wide mb-1">{s.label}</div>
                          <div className={`text-[13px] font-bold font-mono ${s.isPnl ? (s.value >= 0 ? 'text-success' : 'text-danger') : 'text-text1'}`}>
                            {fmtN(s.value, s.isPnl)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Tab bar ── */}
                <div className="border-b border-border1 px-3 pt-2 flex gap-0 overflow-x-auto">
                  {([
                    { key: 'positions',      label: `Positions (${drawerPositions.length})` },
                    { key: 'open_orders',    label: `Open Orders (${drawerOpenOrders.length || drawerAccount?.orders_count || 0})` },
                    { key: 'trade_history',  label: 'Trade History' },
                  ] as const).map(t => (
                    <button key={t.key} onClick={() => setDrawerTab(t.key)}
                      className={`px-3 py-2 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-all -mb-px ${
                        drawerTab === t.key
                          ? 'border-accent text-accent'
                          : 'border-transparent text-text3 hover:text-text2'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* ── Tab content ── */}
                <div className="p-3">

                  {/* POSITIONS */}
                  {drawerTab === 'positions' && (
                    drawerPositions.length === 0
                      ? <div className="text-center py-8 text-[12px] text-text3">No open positions</div>
                      : <div className="space-y-2">
                          {drawerPositions.map((pos, i) => {
                            const isLong = pos.side === 'bid';
                            const tk = tickers[pos.symbol];
                            const markPx = getMarkPrice(tk);
                            const entryPx = Number(pos.entry_price || 0);
                            const amt = Number(pos.amount || 0);
                            // Use unrealized_pnl if available, else compute from mark price
                            const rawPnl = Number(pos.unrealized_pnl ?? 'x');
                            const pnl = isNaN(rawPnl) || pos.unrealized_pnl == null
                              ? (markPx > 0 && entryPx > 0 ? (isLong ? 1 : -1) * (markPx - entryPx) * amt : 0)
                              : rawPnl;
                            const posVal = entryPx * amt;
                            const marginVal = Number(pos.margin || 0);
                            const pnlPct = posVal > 0 ? (pnl / posVal * 100) : 0;
                            return (
                              <div key={i} className="bg-surface2 border border-border1 rounded-xl px-3 py-2.5">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-bold text-text1">{pos.symbol}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isLong ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
                                      {isLong ? 'Long' : 'Short'}
                                    </span>


                                  </div>
                                  <span className={`text-[13px] font-bold font-mono ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                    {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 2 })} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] mb-2">
                                  <div className="flex justify-between"><span className="text-text3">Size</span><span className="text-text2 font-mono">{Number(pos.amount).toFixed(4)} {pos.symbol}</span></div>
                                  <div className="flex justify-between"><span className="text-text3">Mark Price</span><span className="text-text2 font-mono">${fmtPrice(getMarkPrice(tk))}</span></div>
                                  <div className="flex justify-between"><span className="text-text3">Entry / Breakeven</span><span className="text-text2 font-mono">${fmtPrice(Number(pos.entry_price))}</span></div>
                                  <div className="flex justify-between"><span className="text-text3">Margin</span><span className="text-text2 font-mono">{pos.isolated ? 'Isolated' : 'Cross'}{pos.margin ? ` $${Number(pos.margin).toFixed(2)}` : ''}</span></div>
                                  {pos.liquidation_price && <div className="flex justify-between col-span-2"><span className="text-text3">Liq. Price</span><span className="text-danger font-mono">${fmtPrice(Number(pos.liquidation_price))}</span></div>}
                                </div>
                                {/* Show trader leverage badge */}
                                {(() => {
                                  const lev = pos.leverage && Number(pos.leverage) > 0
                                    ? Number(pos.leverage)
                                    : (pos.margin && Number(pos.margin) > 0
                                        ? Math.round((Number(pos.entry_price) * Number(pos.amount)) / Number(pos.margin))
                                        : null);
                                  return lev && lev > 1 ? (
                                    <div className="mb-2 flex items-center gap-1.5 text-[9px] text-text3">
                                      <span className="font-semibold px-1.5 py-0.5 rounded bg-border2 text-text2 font-mono">{lev}×</span>
                                      <span>trader leverage</span>
                                    </div>
                                  ) : null;
                                })()}
                                <button onClick={() => setCopyModal({ trade: { symbol: pos.symbol, side: isLong ? 'open_long' : 'open_short', price: pos.entry_price, amount: pos.amount, created_at: pos.created_at }, traderAddress: selectedTrader!, fav: isCopyFav })}
                                  className="w-full py-1.5 bg-accent/10 text-accent border border-accent/20 rounded-lg text-[11px] font-semibold hover:bg-accent/20 transition-colors">
                                  Copy this position
                                </button>
                              </div>
                            );
                          })}
                        </div>
                  )}

                  {/* OPEN ORDERS */}
                  {drawerTab === 'open_orders' && (
                    drawerOpenOrders.length === 0
                      ? <div className="text-center py-8 text-[12px] text-text3">No open orders</div>
                      : <div>
                          <div className="grid grid-cols-5 gap-2 px-2 py-1.5 border-b border-border1 bg-surface2">
                            {[['oo_sym','Symbol'],['oo_side','Side'],['oo_type','Type'],['oo_price','Price'],['oo_amt','Amount']].map(([k,l]) => (
                              <button key={k} onClick={() => toggleDrawerSort(k)}
                                className={`text-left text-[9px] font-semibold uppercase tracking-wide flex items-center gap-0.5 transition-colors hover:text-accent ${drawerSort.key===k?'text-accent':'text-text3'} ${k==='oo_price'||k==='oo_amt'?'justify-end':''}`}>
                                {l}<span className="text-[7px]">{drawerSort.key===k?(drawerSort.dir==='desc'?'▼':'▲'):'⇅'}</span>
                              </button>
                            ))}
                          </div>
                          {sortDrawer(drawerOpenOrders, (o) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const price = (o as any).initial_price ?? (o as any).average_filled_price ?? o.price ?? '0';
                            if (drawerSort.key==='oo_sym') return o.symbol;
                            if (drawerSort.key==='oo_side') return o.side;
                            if (drawerSort.key==='oo_type') return o.order_type??'';
                            if (drawerSort.key==='oo_price') return Number(price);
                            if (drawerSort.key==='oo_amt') return Number(o.amount);
                            return 0;
                          }).map((o, i) => {
                            const { label, isLong } = sideLabel(o.side);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const price = (o as any).initial_price ?? (o as any).average_filled_price ?? o.price ?? '0';
                            return (
                              <div key={i} className="grid grid-cols-5 gap-2 px-2 py-2 border-b border-border1 last:border-0 text-[11px] hover:bg-surface2/60 transition-colors">
                                <span className="font-semibold text-text1">{o.symbol}</span>
                                <span className={isLong ? 'text-success font-semibold' : 'text-danger font-semibold'}>{label}</span>
                                <span className="text-text3 uppercase">{o.order_type ?? 'limit'}</span>
                                <span className="text-right font-mono text-text2">${fmtPrice(Number(price))}</span>
                                <span className="text-right font-mono text-text2">{Number(o.amount).toFixed(4)}</span>
                              </div>
                            );
                          })}
                        </div>
                  )}

                  {/* TRADE HISTORY */}
                  {drawerTab === 'trade_history' && (
                    drawerTradeHist.length === 0
                      ? <div className="text-center py-8 text-[12px] text-text3">No trade history</div>
                      : <div>
                          <div className="grid grid-cols-5 gap-2 px-2 py-1.5 border-b border-border1 bg-surface2">
                            {[['th_sym','Symbol'],['th_side','Side'],['th_price','Price'],['th_size','Size'],['th_pnl','Realized PnL']].map(([k,l]) => (
                              <button key={k} onClick={() => toggleDrawerSort(k)}
                                className={`text-left text-[9px] font-semibold uppercase tracking-wide flex items-center gap-0.5 transition-colors hover:text-accent ${drawerSort.key===k?'text-accent':'text-text3'} ${k!=='th_sym'&&k!=='th_side'?'justify-end':''}`}>
                                {l}<span className="text-[7px]">{drawerSort.key===k?(drawerSort.dir==='desc'?'▼':'▲'):'⇅'}</span>
                              </button>
                            ))}
                          </div>
                          {sortDrawer(drawerTradeHist, (t) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const pnl = Number((t as any).pnl ?? t.realized_pnl ?? 0);
                            if (drawerSort.key==='th_sym') return t.symbol;
                            if (drawerSort.key==='th_side') return t.side;
                            if (drawerSort.key==='th_price') return Number(t.price);
                            if (drawerSort.key==='th_size') return Number(t.amount);
                            if (drawerSort.key==='th_pnl') return pnl;
                            return 0;
                          }).map((t, i) => {
                            const { label, isLong } = sideLabel(t.side);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const pnl = Number((t as any).pnl ?? t.realized_pnl ?? 0);
                            return (
                              <div key={i} className="grid grid-cols-5 gap-2 px-2 py-2 border-b border-border1 last:border-0 text-[11px] hover:bg-surface2/60 transition-colors">
                                <span className="font-semibold text-text1">{t.symbol}</span>
                                <span className={isLong ? 'text-success font-semibold' : 'text-danger font-semibold'}>{label}</span>
                                <span className="text-right font-mono text-text2">${fmtPrice(Number(t.price))}</span>
                                <span className="text-right font-mono text-text2">{Number(t.amount).toFixed(3)}</span>
                                <span className={`text-right font-mono font-semibold ${pnl > 0 ? 'text-success' : pnl < 0 ? 'text-danger' : 'text-text3'}`}>
                                  {pnl !== 0 ? `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}` : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                  )}



                </div>

                {!drawerLoading && !drawerAccount && !drawerPortfolio && (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                    <div className="text-[12px] text-text3">No portfolio data available for this trader.</div>
                  </div>
                )}

              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
// ─── Copy Trade Modal ─────────────────────────────────────────────────────────
function CopyTradeModal({
  trade, traderAddress, markets, tickers, myBalance, defaultAmount, onConfirm, onClose,
}: {
  trade: TraderTrade;
  traderAddress: string;
  markets: Market[];
  tickers: Record<string, Ticker>;
  myBalance: number;
  defaultAmount: number;
  onConfirm: (
    amount: number,
    leverage: number,
    orderType: 'market' | 'limit',
    limitPrice?: string,
    sl?: number | null,
    tp?: number | null
  ) => Promise<void>;
  onClose: () => void;
}) {
  const { label, isLong } = sideLabel(trade.side);
  const market = markets.find(m => m.symbol === trade.symbol);
  const tk = tickers[trade.symbol];
  const markPrice = getMarkPrice(tk);
  const traderEntry = Number(trade.price || markPrice);
  const maxLev = Number(market?.max_leverage || 20);

  const [amount, setAmount] = useState(Math.max(10, Math.min(defaultAmount, myBalance || defaultAmount)));
  const [leverage, setLeverage] = useState(Math.min(5, maxLev));
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState(String(traderEntry));
  const [slEnabled, setSlEnabled] = useState(false);
  const [slPct, setSlPct] = useState(5);
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpPct, setTpPct] = useState(10);
  const [placing, setPlacing] = useState(false);

  const entryPrice = orderType === 'market' ? markPrice : (Number(limitPrice) || markPrice);
  const positionValue = amount * leverage;
  const liqPrice = entryPrice > 0 && leverage > 0
    ? isLong
      ? entryPrice * (1 - 0.9 / leverage)
      : entryPrice * (1 + 0.9 / leverage)
    : 0;
  const slPrice = slEnabled && entryPrice > 0
    ? (isLong ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100))
    : null;
  const tpPrice = tpEnabled && entryPrice > 0
    ? (isLong ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100))
    : null;
  const isHighLeverage = leverage > 20;
  const presets = [10, 25, 50, 100, 250].filter(p => myBalance <= 0 || p <= myBalance * 2);

  const leveragePct = ((leverage - 1) / (maxLev - 1)) * 100;

  async function handleConfirm() {
    setPlacing(true);
    try {
      await onConfirm(amount, leverage, orderType, orderType === 'limit' ? limitPrice : undefined, slPrice, tpPrice);
      onClose(); // only close on success
    } catch (e) {
      // error is handled by onConfirm via onToast — just reset placing state
    } finally {
      setPlacing(false);
    }
  }

  function TipIcon({ text }: { text: string }) {
    const [show, setShow] = useState(false);
    return (
      <span className="relative inline-flex items-center"
        onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
        <span className="w-3.5 h-3.5 rounded-full border border-border2 text-text3 flex items-center justify-center text-[8px] font-bold cursor-help hover:border-accent hover:text-accent transition-colors">?</span>
        {show && (
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 bg-surface border border-border1 rounded-lg px-2.5 py-2 text-[10px] text-text2 leading-relaxed shadow-card-md z-[200] pointer-events-none whitespace-normal">
            {text}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-surface border border-border1 rounded-2xl shadow-card-md w-[420px] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`px-5 py-4 border-b border-border1 flex items-center justify-between ${isLong ? 'bg-success/5' : 'bg-danger/5'}`}>
          <div className="flex items-center gap-3">
            <CoinLogo symbol={trade.symbol} size={32} />
            <div>
              <div className="text-[14px] font-bold text-text1">{trade.symbol}-PERP · {label}</div>
              <div className="text-[10px] text-text3 font-mono">{fmtShortAddr(traderAddress)}</div>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface2 text-text3 text-lg transition-colors">
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">

          {/* Price comparison */}
          <div className="grid grid-cols-3 divide-x divide-border1 bg-surface2 border border-border1 rounded-xl overflow-hidden">
            {[
              { label: 'Trader Entry', value: '$' + fmtPrice(traderEntry), color: 'text-text1' },
              { label: 'Mark Price', value: '$' + fmtPrice(markPrice), color: markPrice > traderEntry ? 'text-success' : 'text-danger' },
              { label: 'Price Drift', value: traderEntry > 0 ? ((markPrice - traderEntry) / traderEntry * 100).toFixed(2) + '%' : '—',
                color: 'text-text3' },
            ].map(s => (
              <div key={s.label} className="px-3 py-2 text-center">
                <div className="text-[9px] text-text3 uppercase tracking-wide">{s.label}</div>
                <div className={`text-[12px] font-mono font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Margin */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-text1">Margin</span>
                <TipIcon text="Minimum is $10. Your collateral in USDC — position size = Margin × Leverage." />
              </div>
              {myBalance > 0 && (
                <span className="text-[10px] text-text3">
                  Balance: <span className="text-accent font-semibold">${fmt(myBalance, 2)}</span>
                </span>
              )}
            </div>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {presets.map(p => (
                <button key={p} onClick={() => setAmount(p)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                    amount === p ? 'bg-accent text-white border-accent' : 'bg-surface2 border-border1 text-text2 hover:border-accent/40'
                  }`}>
                  ${p}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-text3">$</span>
              <input type="number" value={amount} min={10}
                onChange={e => setAmount(Math.max(10, Number(e.target.value)))}
                className="w-full bg-surface2 border border-border1 rounded-xl pl-6 pr-14 py-2.5 text-[13px] font-mono text-text1 outline-none focus:border-accent transition-colors" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text3">USDC</span>
            </div>
          </div>

          {/* Leverage slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-text1">Leverage</span>
                <TipIcon text={`Multiplies your position size. ${leverage}× means $${positionValue.toFixed(0)} position with $${amount} margin. Higher leverage = higher risk of liquidation.`} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[14px] font-bold font-mono tabular-nums ${isHighLeverage ? 'text-warn' : 'text-accent'}`}>
                  {leverage}×
                </span>
                <span className="text-[10px] text-text3">= ${positionValue.toFixed(0)}</span>
              </div>
            </div>
            {/* Custom slider with colored track */}
            <div className="relative h-5 flex items-center">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-border2" />
              <div
                className={`absolute left-0 h-1.5 rounded-full transition-all ${isHighLeverage ? 'bg-warn' : 'bg-accent'}`}
                style={{ width: `${leveragePct}%` }}
              />
              <input
                type="range" min={1} max={maxLev} value={leverage}
                onChange={e => setLeverage(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-5"
              />
              <div
                className={`absolute w-4 h-4 rounded-full border-2 border-white shadow pointer-events-none transition-all ${isHighLeverage ? 'bg-warn' : 'bg-accent'}`}
                style={{ left: `calc(${leveragePct}% - 8px)` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-text3">1×</span>
              <span className="text-[9px] text-text3">{maxLev}× max</span>
            </div>
            {isHighLeverage && (
              <div className="mt-1.5 px-2.5 py-1.5 bg-warn/8 border border-warn/20 rounded-lg text-[10px] text-warn">
                ⚠ High leverage — liquidation price is close to entry
              </div>
            )}
          </div>

          {/* Order type */}
          <div className="flex bg-surface2 border border-border1 rounded-xl overflow-hidden">
            {(['market', 'limit'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                className={`flex-1 py-2 text-[12px] font-semibold capitalize transition-all ${
                  orderType === t ? 'bg-surface text-text1 shadow-sm' : 'text-text3 hover:text-text2'
                }`}>
                {t}
              </button>
            ))}
          </div>

          {orderType === 'limit' && (
            <div className="relative">
              <input type="number" value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                placeholder="Limit price"
                className="w-full bg-surface2 border border-border1 rounded-xl px-3 py-2.5 text-[13px] font-mono text-text1 outline-none focus:border-accent transition-colors" />
              <button onClick={() => setLimitPrice(String(markPrice))}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-accent hover:underline">
                Mark
              </button>
            </div>
          )}

          {/* Liquidation price */}
          {liqPrice > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-danger/5 border border-danger/20 rounded-xl">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-danger font-semibold">Est. Liquidation</span>
                <TipIcon text="If the price reaches this level, your position will be automatically closed and you will lose your margin. Keep leverage low to keep this price far from entry." />
              </div>
              <span className="text-[12px] font-mono font-bold text-danger">${fmtPrice(liqPrice)}</span>
            </div>
          )}

          {/* SL / TP */}
          <div className="grid grid-cols-2 gap-2">
            {/* Stop Loss */}
            <div className={`border rounded-xl p-3 transition-all ${slEnabled ? 'border-danger/40 bg-danger/5' : 'border-border1'}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button onClick={() => setSlEnabled(v => !v)}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${slEnabled ? 'text-danger' : 'text-text3'}`}>
                  <div className={`relative w-7 h-4 rounded-full transition-all ${slEnabled ? 'bg-danger' : 'bg-border2'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${slEnabled ? 'translate-x-3' : ''}`} />
                  </div>
                  Stop Loss
                </button>
                <TipIcon text="Auto-close if price moves against you by this % from entry." />
              </div>
              {slEnabled ? (
                <>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-text3">Trigger</span>
                    <span className="font-bold text-danger font-mono">{slPct}% · ${slPrice ? fmtPrice(slPrice) : '—'}</span>
                  </div>
                  <div className="relative h-4 flex items-center">
                    <div className="absolute inset-x-0 h-1 rounded-full bg-border2" />
                    <div className="absolute left-0 h-1 rounded-full bg-danger"
                      style={{ width: `${((slPct - 0.5) / 49.5) * 100}%` }} />
                    <input type="range" value={slPct} min={0.5} max={50} step={0.5}
                      onChange={e => setSlPct(Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-4" />
                    <div className="absolute w-3 h-3 rounded-full bg-danger border-2 border-white shadow pointer-events-none"
                      style={{ left: `calc(${((slPct - 0.5) / 49.5) * 100}% - 6px)` }} />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-text3">0.5%</span>
                    <span className="text-[9px] text-text3">50%</span>
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-text3">Off</div>
              )}
            </div>

            {/* Take Profit */}
            <div className={`border rounded-xl p-3 transition-all ${tpEnabled ? 'border-success/40 bg-success/5' : 'border-border1'}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button onClick={() => setTpEnabled(v => !v)}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${tpEnabled ? 'text-success' : 'text-text3'}`}>
                  <div className={`relative w-7 h-4 rounded-full transition-all ${tpEnabled ? 'bg-success' : 'bg-border2'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${tpEnabled ? 'translate-x-3' : ''}`} />
                  </div>
                  Take Profit
                </button>
                <TipIcon text="Auto-close when price moves in your favor by this % from entry." />
              </div>
              {tpEnabled ? (
                <>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-text3">Target</span>
                    <span className="font-bold text-success font-mono">{tpPct}% · ${tpPrice ? fmtPrice(tpPrice) : '—'}</span>
                  </div>
                  <div className="relative h-4 flex items-center">
                    <div className="absolute inset-x-0 h-1 rounded-full bg-border2" />
                    <div className="absolute left-0 h-1 rounded-full bg-success"
                      style={{ width: `${((tpPct - 1) / 99) * 100}%` }} />
                    <input type="range" value={tpPct} min={1} max={100} step={0.5}
                      onChange={e => setTpPct(Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-4" />
                    <div className="absolute w-3 h-3 rounded-full bg-success border-2 border-white shadow pointer-events-none"
                      style={{ left: `calc(${((tpPct - 1) / 99) * 100}% - 6px)` }} />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-text3">1%</span>
                    <span className="text-[9px] text-text3">100%</span>
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-text3">Off</div>
              )}
            </div>
          </div>

          {/* Price drift warning — only show if very large drift */}
          {entryPrice > 0 && traderEntry > 0 && (() => {
            const driftPct = Math.abs((markPrice - traderEntry) / traderEntry * 100);
            if (driftPct < 15) return null;
            return (
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border bg-warn/8 border-warn/30 text-warn text-[11px] leading-relaxed">
                <span className="text-[14px] shrink-0">⚠️</span>
                <div>
                  <strong>Price moved {driftPct.toFixed(1)}% since trader entry.</strong> Your order will execute at the current mark price, not the trader&apos;s entry price. Verify the trade still makes sense before copying.
                </div>
              </div>
            );
          })()}

          {/* CTA */}
          <button onClick={handleConfirm} disabled={placing || amount <= 0}
            className={`w-full py-3 rounded-xl font-bold text-[13px] transition-all flex items-center justify-center gap-2 ${
              isLong
                ? 'bg-success text-white hover:bg-success/90 disabled:bg-success/40'
                : 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40'
            } disabled:cursor-not-allowed`}>
            {placing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Placing Order...
              </>
            ) : (
              `Copy ${label} · $${amount} · ${leverage}×${slEnabled ? ` · SL ${slPct}%` : ''}${tpEnabled ? ` · TP ${tpPct}%` : ''}`
            )}
          </button>

          <p className="text-[10px] text-text3 text-center leading-relaxed">
            Builder code <span className="font-mono text-accent">PACIFICALENS</span> · No extra approval needed
          </p>
        </div>
      </div>
    </div>
  );
}
