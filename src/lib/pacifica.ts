async function proxyGet<T>(endpoint: string): Promise<T> {
  const res = await fetch(`/api/proxy?path=${encodeURIComponent(endpoint)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

interface PacificaRes<T> {
  success: boolean;
  data: T;
  error: string | null;
  code: number | null;
}

// GET /api/v1/info
export interface Market {
  symbol: string;
  tick_size: string;
  lot_size: string;
  max_leverage: number;
  min_order_size: string;
  max_order_size: string;
  funding_rate: string;
  next_funding_rate: string;
  isolated_only: boolean;
}

// GET /api/v1/info/prices
export interface Ticker {
  symbol: string;
  mark: string;
  oracle: string;
  mid: string;
  funding: string;
  next_funding: string;
  open_interest: string;
  volume_24h: string;
  yesterday_price: string;
  timestamp: number;
}

export interface FundingRate {
  symbol: string;
  funding_rate: string;
}

// GET /api/v1/positions — side: "bid"=long, "ask"=short, size field is "amount"
export interface Position {
  symbol: string;
  side: string;       // "bid" = long, "ask" = short
  amount: string;     // size in tokens
  entry_price: string;
  funding: string;
  margin?: string;
  isolated: boolean;
  leverage?: string;
  liquidation_price?: string;
  unrealized_pnl?: string;
  created_at: number;
  updated_at: number;
}

// GET /api/v1/account
export interface AccountInfo {
  balance: string;
  account_equity: string;
  available_to_spend: string;
  available_to_withdraw: string;
  total_margin_used: string;
  positions_count: number;
  orders_count?: number;
  maker_fee?: string;
  taker_fee?: string;
}

// GET /api/v1/info — market list
export async function getMarkets(): Promise<Market[]> {
  try {
    const res = await proxyGet<PacificaRes<Market[]>>('info');
    if (res.success && Array.isArray(res.data)) return res.data;
    return [];
  } catch (e) {
    console.error('[Pacifica] getMarkets:', e);
    return [];
  }
}

// GET /api/v1/info/prices
export async function getTickers(): Promise<Record<string, Ticker>> {
  try {
    const res = await proxyGet<PacificaRes<Ticker[]>>('info/prices');
    if (res.success && Array.isArray(res.data)) {
      return Object.fromEntries(res.data.map(t => [t.symbol, t]));
    }
    return {};
  } catch (e) {
    console.error('[Pacifica] getTickers:', e);
    return {};
  }
}

// Funding from /info/prices
export async function getFundingRates(): Promise<Record<string, FundingRate>> {
  try {
    const res = await proxyGet<PacificaRes<Ticker[]>>('info/prices');
    if (res.success && Array.isArray(res.data)) {
      return Object.fromEntries(
        res.data.map(t => [t.symbol, { symbol: t.symbol, funding_rate: t.funding }])
      );
    }
    return {};
  } catch { return {}; }
}

// GET /api/v1/account?account=WALLET
export async function getAccountInfo(wallet: string): Promise<AccountInfo | null> {
  try {
    const res = await proxyGet<PacificaRes<AccountInfo>>(`account?account=${wallet}`);
    return res.success ? res.data : null;
  } catch { return null; }
}

// GET /api/v1/positions?account=WALLET
export async function getPositions(wallet: string): Promise<Position[]> {
  try {
    const res = await proxyGet<PacificaRes<Position[]>>(`positions?account=${wallet}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    return [];
  } catch { return []; }
}

// Orderbook: data.l[0] = bids, data.l[1] = asks
export interface OrderbookLevel { p: string; a: string; n: number; }
export interface Orderbook { bids: OrderbookLevel[]; asks: OrderbookLevel[]; timestamp: number; }

export async function getOrderbook(symbol: string): Promise<Orderbook | null> {
  try {
    const res = await proxyGet<PacificaRes<{ s: string; l: [OrderbookLevel[], OrderbookLevel[]]; t: number }>>(`book?symbol=${symbol}`);
    if (res.success && res.data) {
      return { bids: res.data.l[0] ?? [], asks: res.data.l[1] ?? [], timestamp: res.data.t };
    }
    return null;
  } catch { return null; }
}

// Candles: t=open_time, o=open, h=high, l=low, c=close, v=volume
export interface Candle { t: number; T: number; o: string; h: string; l: string; c: string; v: string; n: number; }

export async function getCandles(symbol: string, interval = '1h', limit = 100): Promise<Candle[]> {
  try {
    const end = Date.now();
    const intervalMs: Record<string, number> = {
      '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
      '1h': 3600000, '4h': 14400000, '1d': 86400000,
    };
    const start = end - (intervalMs[interval] || 3600000) * limit;
    const res = await proxyGet<PacificaRes<Candle[]>>(`kline?symbol=${symbol}&interval=${interval}&start_time=${start}&end_time=${end}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    return [];
  } catch { return []; }
}

// Recent trades — cause:"market_liquidation" = liquidation
export interface Trade {
  event_type: string;
  price: string;
  amount: string;
  side: string;   // open_long, open_short, close_long, close_short
  cause: string;  // normal | market_liquidation | backstop_liquidation | settlement
  created_at: number;
}

export async function getRecentTrades(symbol: string): Promise<Trade[]> {
  try {
    const res = await proxyGet<PacificaRes<Trade[]>>(`trades?symbol=${symbol}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    return [];
  } catch { return []; }
}

export interface TradeHistory {
  history_id?: number;
  order_id?: number;
  id?: string;
  symbol: string;
  side: string;
  price: string;
  amount: string;
  fee?: string;
  pnl?: string;          // actual field from API
  realized_pnl?: string; // fallback alias
  entry_price?: string;
  event_type?: string;
  created_at: string | number;
  cause?: string;
}

export interface EquityHistory {
  equity: string;
  timestamp: string;
}

export interface FundingHistory {
  symbol: string;
  amount: string;
  rate: string;
  timestamp: string;
}

export async function getTradeHistory(wallet: string, limit = 50): Promise<TradeHistory[]> {
  try {
    // Try newer endpoint first
    const res = await proxyGet<PacificaRes<TradeHistory[]>>(`trades/history?account=${wallet}&limit=${limit}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    // Fallback to legacy endpoint
    const res2 = await proxyGet<PacificaRes<TradeHistory[]>>(`account/trade_history?account=${wallet}&limit=${limit}`);
    if (res2.success && Array.isArray(res2.data)) return res2.data;
    return [];
  } catch { return []; }
}

export async function getEquityHistory(wallet: string): Promise<EquityHistory[]> {
  try {
    const res = await proxyGet<PacificaRes<EquityHistory[]>>(`account/equity_history?account=${wallet}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    return [];
  } catch { return []; }
}

export async function getFundingHistory(wallet: string): Promise<FundingHistory[]> {
  try {
    const res = await proxyGet<PacificaRes<FundingHistory[]>>(`account/funding_history?account=${wallet}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    const res2 = await proxyGet<PacificaRes<FundingHistory[]>>(`funding_history?account=${wallet}`);
    if (res2.success && Array.isArray(res2.data)) return res2.data;
    return [];
  } catch { return []; }
}

export interface OpenOrder {
  order_id?: number;
  id?: string;
  symbol: string;
  side: string;
  order_type?: string;
  order_status?: string;   // actual field from API: 'open', 'filled', 'cancelled'
  status?: string;         // fallback alias
  initial_price?: string;  // actual price field from API
  price?: string;          // fallback alias
  average_filled_price?: string;
  amount: string;
  filled_amount?: string;
  reduce_only?: boolean;
  created_at: string | number;
}

export async function getOpenOrders(wallet: string): Promise<OpenOrder[]> {
  try {
    // Try account-specific endpoint first, then fallback
    const res = await proxyGet<PacificaRes<OpenOrder[]>>(`orders/open?account=${wallet}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    // Some API versions use different path
    const res2 = await proxyGet<PacificaRes<OpenOrder[]>>(`account/orders/open?account=${wallet}`);
    if (res2.success && Array.isArray(res2.data)) return res2.data;
    return [];
  } catch { return []; }
}

export async function getOrderHistory(wallet: string, limit = 100): Promise<OpenOrder[]> {
  try {
    const res = await proxyGet<PacificaRes<OpenOrder[]>>(`orders/history?account=${wallet}&limit=${limit}`);
    if (res.success && Array.isArray(res.data)) return res.data;
    return [];
  } catch { return []; }
}

// ── Portfolio endpoint (undocumented but confirmed live) ──────────────────────
// GET /api/v1/portfolio?account=WALLET
// Returns: sharpe_ratio, max_drawdown, return_percent, trading_volume, pnl, equity, etc.
export interface PortfolioStats {
  pnl?: string;
  return_percent?: string;
  sharpe_ratio?: string;
  max_drawdown?: string;
  trading_volume?: string;
  account_equity?: string;
  balance?: string;
  // any extra fields the API returns
  [key: string]: unknown;
}

export async function getPortfolioStats(wallet: string): Promise<PortfolioStats | null> {
  try {
    const res = await fetch(
      `/api/proxy?path=${encodeURIComponent(`portfolio?account=${wallet}`)}`,
      { cache: 'no-store' }
    );
    const json = await res.json();
    // API may return { success, data } or direct object
    if (json.success && json.data) return json.data as PortfolioStats;
    if (json.pnl !== undefined || json.sharpe_ratio !== undefined) return json as PortfolioStats;
    // data might be an array with one entry
    if (json.success && Array.isArray(json.data) && json.data.length > 0) return json.data[0] as PortfolioStats;
    return null;
  } catch { return null; }
}

// ── Trades history (confirmed endpoint from docs) ─────────────────────────────
// GET /api/v1/trades/history?account=WALLET&limit=30
// Note: this is different from account/trade_history — newer endpoint
export async function getTradesHistory(wallet: string, limit = 30): Promise<TradeHistory[]> {
  try {
    const res = await fetch(
      `/api/proxy?path=${encodeURIComponent(`trades/history?account=${wallet}&limit=${limit}`)}`,
      { cache: 'no-store' }
    );
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) return json.data as TradeHistory[];
    return [];
  } catch { return []; }
}

// ── Position history ──────────────────────────────────────────────────────────
// GET /api/v1/positions/history?account=WALLET
export interface PositionHistory {
  history_id: number;
  order_id: number;
  symbol: string;
  amount: string;
  price: string;
  entry_price: string;
  fee: string;
  pnl: string;
  side: string;
  created_at: number;
}

export async function getPositionHistory(wallet: string, limit = 20): Promise<PositionHistory[]> {
  try {
    const res = await fetch(
      `/api/proxy?path=${encodeURIComponent(`positions/history?account=${wallet}&limit=${limit}`)}`,
      { cache: 'no-store' }
    );
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) return json.data as PositionHistory[];
    return [];
  } catch { return []; }
}
