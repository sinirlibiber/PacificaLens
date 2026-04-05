'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth';
import { usePathname, useRouter } from 'next/navigation';
import { useMarkets } from '@/hooks/useMarkets';
import { useAccount } from '@/hooks/useAccount';
import { Header, getSolanaAddress } from '@/components/Header';

import { Toast } from '@/components/Toast';
import { getMarkPrice } from '@/lib/utils';
import { submitLimitOrder, submitMarketOrder, updateLeverage, checkBuilderApproval, approveBuilderCode, toBase58, roundToTick } from '@/lib/pacificaSigning';
import { CalcResult } from '@/components/Calculator';
import { useOrderLog } from '@/hooks/useOrderLog';

interface ToastState { message: string; type: 'success' | 'error' | 'info' | 'loading'; duration?: number; action?: { label: string; href: string }; }
type Tab = 'overview' | 'risk' | 'arbitrage' | 'arbitrage-bot' | 'copy' | 'portfolio' | 'analytics';

const ROUTE_MAP: Record<string, Tab> = {
  '/overview': 'overview',
  '/risk': 'risk',
  '/arbitrage': 'arbitrage',
  '/arbitrage/bot': 'arbitrage-bot',
  '/smart-money': 'copy',
  '/portfolio': 'portfolio',
  '/analytics': 'analytics',
};

const TAB_ROUTE: Record<Tab, string> = {
  'overview': '/overview',
  'risk': '/risk',
  'arbitrage': '/arbitrage',
  'arbitrage-bot': '/arbitrage/bot',
  'copy': '/smart-money',
  'portfolio': '/portfolio',
  'analytics': '/analytics',
};

function RedirectHome() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const pathname = usePathname();
  const router = useRouter();

  // Get Solana wallet - check both useSolanaWallets and linkedAccounts
  const solanaWalletAddr = solanaWallets[0]?.address ?? null;
  const linkedSolanaAddr = getSolanaAddress(user);
  const wallet = solanaWalletAddr || linkedSolanaAddr;
  const { markets, tickers, fundingRates, loading, error } = useMarkets();
  const { accountInfo, positions } = useAccount(wallet);

  const [accountSize, setAccountSize] = useState(0);
  const { addEntry, updateEntry } = useOrderLog(wallet);
  const [toasts, setToasts] = useState<(ToastState & { id: string })[]>([]);
  const addToast = (t: ToastState) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.filter(x => x.type !== 'loading'), { ...t, id }]);
    return id;
  };
  const removeToast = (id: string) => setToasts(prev => prev.filter(x => x.id !== id));
  // Legacy compat shim
  const setToast = (t: ToastState | null) => { if (t) addToast(t); else setToasts([]); };
  const [builderApproved, setBuilderApproved] = useState(false);
  const [approvingBuilder, setApprovingBuilder] = useState(false);

  const currentTab: Tab = ROUTE_MAP[pathname] ?? 'overview';

  useEffect(() => {
    if (accountInfo && accountSize === 0) {
      const bal = Number(accountInfo.account_equity || accountInfo.balance || 0);
      if (bal > 0) setAccountSize(bal);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountInfo]);

  // Check + auto-request builder code approval once wallet is connected
  useEffect(() => {
    if (!wallet || !authenticated) return;
    const LS_KEY = `pacificalens_builder_approved_${wallet}`;
    // Check localStorage cache first to avoid repeated API calls
    if (localStorage.getItem(LS_KEY) === '1') { setBuilderApproved(true); return; }

    checkBuilderApproval(wallet).then(approved => {
      if (approved) {
        setBuilderApproved(true);
        localStorage.setItem(LS_KEY, '1');
      }
      // Not approved — will prompt on first order attempt via ensureBuilderApproved()
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, authenticated]);

  // Call this before any order — prompts approval if not yet done
  async function ensureBuilderApproved(): Promise<boolean> {
    if (builderApproved) return true;
    if (approvingBuilder) return false;
    if (!wallet) { setToast({ message: 'Connect your wallet first', type: 'error' }); return false; }

    // Check API first (skip localStorage cache — it may be stale)
    setApprovingBuilder(true);
    setToast({ message: 'Checking builder approval...', type: 'loading', duration: 0 });
    try {
      const alreadyApproved = await checkBuilderApproval(wallet);
      if (alreadyApproved) {
        setBuilderApproved(true);
        localStorage.setItem(`pacificalens_builder_approved_${wallet}`, '1');
        setToasts([]); // clear loading toast
        return true;
      }
    } catch { /* ignore, proceed to approve */ }

    // Not approved — prompt wallet signature
    setToast({ message: 'Please sign in your wallet to approve PACIFICALENS (one-time setup)...', type: 'loading', duration: 0 });
    try {
      // Use shared walletSignFn which handles embedded + external wallets (Phantom, Solflare)
      const result = await approveBuilderCode(wallet, walletSignFn);
      if (result.success) {
        setBuilderApproved(true);
        localStorage.setItem(`pacificalens_builder_approved_${wallet}`, '1');
        setToast({ message: '✓ Approved! Placing order...', type: 'success' });
        return true;
      } else {
        setToast({ message: `Approval failed: ${result.error}`, type: 'error' });
        return false;
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('rejected') || msg.includes('cancel') || msg.includes('denied')) {
        setToast({ message: 'Signature rejected. Order cancelled.', type: 'error' });
      } else {
        setToast({ message: `Approval error: ${msg}`, type: 'error' });
      }
      return false;
    } finally {
      setApprovingBuilder(false);
    }
  }

  function handleTabChange(tab: Tab) {
    router.push(TAB_ROUTE[tab]);
  }

  // Shared wallet sign function — used by all order flows
  async function walletSignFn(msgBytes: Uint8Array): Promise<string> {

    const isUserRejection = (e: unknown) => {
      const msg = String(e).toLowerCase();
      return msg.includes('reject') || msg.includes('cancel') || msg.includes('denied') || msg.includes('user rejected');
    };

    // 1. Try Privy-managed Solana wallets (embedded wallets created by Privy)
    const solanaWallet =
      solanaWallets.find(w => w.address === wallet) ||
      solanaWallets.find(w => w.address === linkedSolanaAddr) ||
      solanaWallets[0];
    if (solanaWallet) {
      try {
        const sigResult = await solanaWallet.signMessage(msgBytes);
        if (typeof sigResult === 'string') return sigResult;
        return toBase58(sigResult as unknown as Uint8Array);
      } catch (e) {
        if (isUserRejection(e)) throw new Error('Signature rejected by user.');
        // otherwise fall through to window.solana
      }
    }

    // 2. Try all known window-level Solana wallet providers
    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, any>) : null;
    // Check providers in priority order: solana (Phantom), solflare, backpack, okxwallet.solana, coin98.sol
    const solanaProviders = [
      win?.solana,           // Phantom (and other wallets that hijack window.solana)
      win?.solflare,         // Solflare
      win?.backpack?.solana ?? win?.backpack, // Backpack
      win?.okxwallet?.solana, // OKX
      win?.coin98?.sol,       // Coin98
      win?.glowSolana,        // Glow
    ].filter(Boolean);

    for (const provider of solanaProviders) {
      if (!provider?.signMessage) continue;
      try {
        const resp = await provider.signMessage(msgBytes, 'utf8');
        // Different wallets return different formats:
        // Phantom: { signature: Uint8Array, publicKey }
        // Backpack: Uint8Array directly
        // Solflare: { signature: Uint8Array }
        const sig: Uint8Array = resp?.signature ?? resp;
        if (sig instanceof Uint8Array && sig.length === 64) {
          return toBase58(sig);
        }
      } catch (e) {
        if (isUserRejection(e)) throw new Error('Signature rejected by user.');
        // try next provider
      }
    }

    throw new Error('No Solana wallet found. Open Phantom, Solflare, or Backpack and try again.');
  }

  async function handleExecute(r: CalcResult, symbol: string) {
    if (!wallet) { setToast({ message: 'Connect your wallet first', type: 'error' }); return; }
    const approved = await ensureBuilderApproved();
    if (!approved) return;
    setToast({ message: `Preparing ${r.side.toUpperCase()} order for ${symbol}...`, type: 'info' });
    try {
      const market = markets.find(m => m.symbol === symbol);
      const markPrice = getMarkPrice(tickers[symbol]);
      // Use shared walletSignFn which handles all wallet types (embedded + external)
      const privySign = walletSignFn;
      const lotDecimals = market?.lot_size ? Math.ceil(-Math.log10(Number(market.lot_size))) : 4;
      const orderAmount = r.positionSize.toFixed(lotDecimals);
      // Bug 2 fix: use user's entry price for limit orders, fall back to mark price
      const orderPrice = r.orderType === 'market'
        ? (markPrice > 0 ? String(markPrice) : '0')
        : (r.entryPrice > 0 ? String(r.entryPrice) : (markPrice > 0 ? String(markPrice) : '0'));
      const orderSide = r.side === 'long' ? 'bid' : 'ask';

      // Set leverage for this symbol before placing the order
      if (r.leverage && r.leverage > 0) {
        await updateLeverage(wallet, symbol, r.leverage, privySign);
      }

      const logId = addEntry({
        symbol, side: orderSide,
        amount: orderAmount, price: orderPrice,
        orderType: r.orderType === 'market' ? 'market' : 'limit',
        status: 'pending', source: 'manual',
      });

      let result: { success: boolean; orderId?: string; error?: string };
      // Bug 1 fix: route to correct order function based on orderType
      if (r.orderType === 'market') {
        result = await submitMarketOrder(wallet, {
          symbol, amount: orderAmount, side: orderSide,
          reduce_only: false,
          take_profit: r.tp1 > 0 ? { stop_price: roundToTick(r.tp1, market?.tick_size || '0.01') } : undefined,
          stop_loss: r.stopLoss > 0 ? { stop_price: roundToTick(r.stopLoss, market?.tick_size || '0.01') } : undefined,
        }, privySign);
      } else {
        result = await submitLimitOrder(wallet, {
          symbol, price: orderPrice, amount: orderAmount, side: orderSide,
          tif: 'GTC', reduce_only: false,
          take_profit: r.tp1 > 0 ? { stop_price: roundToTick(r.tp1, market?.tick_size || '0.01') } : undefined,
          stop_loss: r.stopLoss > 0 ? { stop_price: roundToTick(r.stopLoss, market?.tick_size || '0.01') } : undefined,
        }, privySign);
      }
      if (result.success) {
        updateEntry(logId, { status: 'success', orderId: result.orderId });
        setToast({ message: `✓ ${r.side.toUpperCase()} order placed!`, type: 'success', action: { label: 'View Portfolio', href: '/portfolio' } });
      } else {
        updateEntry(logId, { status: 'failed', error: result.error });
        setToast({ message: `Order error: ${result.error}`, type: 'error' });
        setTimeout(() => window.open(`https://app.pacifica.fi/trade/${symbol}`, '_blank'), 1500);
      }
    } catch (e) {
      setToast({ message: `Error: ${String(e)}`, type: 'error' });
      setTimeout(() => window.open(`https://app.pacifica.fi/trade/${symbol}`, '_blank'), 1500);
    }
  }

  if (!ready) return (
    <div className="flex items-center justify-center h-screen bg-bg gap-3">
      <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
      <span className="text-[12px] text-text3">Loading PacificaLens...</span>
    </div>
  );

  // Pass shared state via context-like props — children use these via context
  return (
    <AppShellContext.Provider value={{ markets, tickers, fundingRates, positions, accountInfo, accountSize, setAccountSize, wallet, error, handleExecute, loading, ensureBuilderApproved, builderApproved, walletSignFn, setToast }}>
      <div className="flex flex-col h-screen overflow-hidden bg-bg">
        <Header tab={currentTab} onTabChange={handleTabChange} accountInfo={accountInfo} />
        {loading && authenticated ? (
          <div className="flex items-center justify-center flex-1 gap-3">
            <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
            <span className="text-[12px] text-text3">Loading markets...</span>
          </div>
        ) : (
          <>
            {/* Demo mode banner */}
            {!authenticated && (
              <div className="flex items-center justify-center gap-3 px-4 py-1.5 text-[11px] shrink-0"
                style={{ background: 'rgba(0,180,216,0.08)', borderBottom: '1px solid rgba(0,180,216,0.15)' }}>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                  style={{ background: 'rgba(0,180,216,0.15)', color: '#00b4d8' }}>DEMO</span>
                <span style={{ color: 'rgba(160,200,220,0.8)' }}>
                  Viewing in read-only mode — connect wallet to trade and access personal features
                </span>
              </div>
            )}
            {children}
          </>
        )}
        <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 items-end">
          {toasts.map(t => (
            <Toast key={t.id} message={t.message} type={t.type} duration={t.duration} action={t.action} onClose={() => removeToast(t.id)} />
          ))}
        </div>
      </div>
    </AppShellContext.Provider>
  );
}

// Context
import { createContext, useContext } from 'react';
import { Market, Ticker, FundingRate, Position, AccountInfo } from '@/lib/pacifica';

interface ShellCtx {
  markets: Market[];
  tickers: Record<string, Ticker>;
  fundingRates: Record<string, FundingRate>;
  positions: Position[];
  accountInfo: AccountInfo | null;
  accountSize: number;
  setAccountSize: (v: number) => void;
  wallet: string | null;
  error: string | null | undefined;
  handleExecute: (r: CalcResult, symbol: string) => void;
  loading: boolean;
  ensureBuilderApproved: () => Promise<boolean>;
  builderApproved: boolean;
  walletSignFn: (msgBytes: Uint8Array) => Promise<string>;
  setToast: (t: { message: string; type: 'success' | 'error' | 'info' | 'loading'; duration?: number } | null) => void;
}

export const AppShellContext = createContext<ShellCtx>({
  markets: [], tickers: {}, fundingRates: {}, positions: [], accountInfo: null,
  accountSize: 0, setAccountSize: () => {}, wallet: null, error: null,
  handleExecute: () => {}, loading: false, ensureBuilderApproved: async () => false, builderApproved: false,
  walletSignFn: async () => { throw new Error('No wallet'); },
  setToast: () => {},
});

export function useShell() { return useContext(AppShellContext); }
