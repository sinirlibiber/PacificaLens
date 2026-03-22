'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth';
import { usePathname, useRouter } from 'next/navigation';
import { useMarkets } from '@/hooks/useMarkets';
import { useAccount } from '@/hooks/useAccount';
import { Header, getSolanaAddress } from '@/components/Header';
import { ConnectScreen } from '@/components/ConnectScreen';
import { Toast } from '@/components/Toast';
import { getMarkPrice } from '@/lib/utils';
import { submitLimitOrder, checkBuilderApproval, approveBuilderCode, toBase58 } from '@/lib/pacificaSigning';
import { CalcResult } from '@/components/Calculator';
import { useOrderLog } from '@/hooks/useOrderLog';

interface ToastState { message: string; type: 'success' | 'error' | 'info' | 'loading'; duration?: number; action?: { label: string; href: string }; }
type Tab = 'overview' | 'risk' | 'arbitrage' | 'arbitrage-bot' | 'whale' | 'copy' | 'portfolio' | 'analytics';

const ROUTE_MAP: Record<string, Tab> = {
  '/overview': 'overview',
  '/risk': 'risk',
  '/arbitrage': 'arbitrage',
  '/arbitrage/bot': 'arbitrage-bot',
  '/smart-money': 'whale',
  '/copy-trading': 'copy',
  '/portfolio': 'portfolio',
  '/analytics': 'analytics',
};

const TAB_ROUTE: Record<Tab, string> = {
  'overview': '/overview',
  'risk': '/risk',
  'arbitrage': '/arbitrage',
  'arbitrage-bot': '/arbitrage/bot',
  'whale': '/smart-money',
  'copy': '/copy-trading',
  'portfolio': '/portfolio',
  'analytics': '/analytics',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, signMessage } = usePrivy();
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
      const solanaWallet = solanaWallets.find(w => w.address === wallet) || solanaWallets[0];
      if (!solanaWallet) {
        setToast({ message: 'No Solana wallet found. Connect Phantom or Solflare.', type: 'error' });
        return false;
      }
      const privySign = async (msgBytes: Uint8Array): Promise<string> => {
        const sigResult = await solanaWallet.signMessage(msgBytes);
        if (typeof sigResult === 'string') return sigResult;
        return toBase58(sigResult as unknown as Uint8Array);
      };
      const result = await approveBuilderCode(wallet, privySign);
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

  async function handleExecute(r: CalcResult, symbol: string) {
    if (!wallet) { setToast({ message: 'Connect your wallet first', type: 'error' }); return; }
    const approved = await ensureBuilderApproved();
    if (!approved) return;
    const solanaWallet = solanaWallets.find(w => w.address === wallet) || solanaWallets[0];
    setToast({ message: `Preparing ${r.side.toUpperCase()} order for ${symbol}...`, type: 'info' });
    try {
      const market = markets.find(m => m.symbol === symbol);
      const markPrice = getMarkPrice(tickers[symbol]);
      // privySign: takes Uint8Array (already encoded payload), returns base58 signature
      const privySign = async (msgBytes: Uint8Array): Promise<string> => {
        if (solanaWallet) {
          // Privy Solana wallet: signMessage takes Uint8Array
          const sigResult = await solanaWallet.signMessage(msgBytes);
          if (typeof sigResult === 'string') return sigResult;
          return toBase58(sigResult as unknown as Uint8Array);
        } else if (signMessage) {
          // Fallback: usePrivy signMessage (needs string)
          const msgStr = new TextDecoder().decode(msgBytes);
          const result = await signMessage(msgStr);
          return typeof result === 'string' ? result : toBase58(result as unknown as Uint8Array);
        }
        throw new Error('No signing method available — connect a Solana wallet');
      };
      const orderAmount = r.positionSize.toFixed(market?.lot_size ? Math.ceil(-Math.log10(Number(market.lot_size))) : 4);
      const orderPrice = markPrice > 0 ? String(markPrice) : '0';
      const logId = addEntry({
        symbol, side: r.side === 'long' ? 'bid' : 'ask',
        amount: orderAmount, price: orderPrice,
        orderType: 'limit', status: 'pending', source: 'manual',
      });
      const result = await submitLimitOrder(wallet, {
        symbol, price: orderPrice, amount: orderAmount,
        side: r.side === 'long' ? 'bid' : 'ask',
        tif: 'GTC', reduce_only: false,
        take_profit: r.tp2 > 0 ? { stop_price: String(r.tp2) } : undefined,
      }, privySign);
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
    <AppShellContext.Provider value={{ markets, tickers, fundingRates, positions, accountInfo, accountSize, setAccountSize, wallet, error, handleExecute, loading, ensureBuilderApproved, builderApproved }}>
      <div className="flex flex-col h-screen overflow-hidden bg-bg">
        <Header tab={currentTab} onTabChange={handleTabChange} accountInfo={accountInfo} />
        {!authenticated ? <ConnectScreen /> : (
          loading ? (
            <div className="flex items-center justify-center flex-1 gap-3">
              <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
              <span className="text-[12px] text-text3">Loading markets...</span>
            </div>
          ) : children
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
}

export const AppShellContext = createContext<ShellCtx>({
  markets: [], tickers: {}, fundingRates: {}, positions: [], accountInfo: null,
  accountSize: 0, setAccountSize: () => {}, wallet: null, error: null,
  handleExecute: () => {}, loading: false, ensureBuilderApproved: async () => false, builderApproved: false,
});

export function useShell() { return useContext(AppShellContext); }
