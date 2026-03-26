// Pacifica order signing — Ed25519 via Privy wallet
// Docs: https://pacifica.gitbook.io/docs/api-documentation/api/signing/implementation

const BUILDER_CODE = 'PACIFICALENS';

// Recursively sort JSON keys alphabetically
function sortJsonKeys(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortJsonKeys(obj[key]);
    }
    return sorted;
  }
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  return value;
}

// Build the message to sign — builder_code MUST be inside data per docs
// Returns {payload, timestamp} so timestamp can be reused in request body
export function buildSigningPayload(
  type: string,
  data: Record<string, unknown>
): { payload: string; timestamp: number } {
  const timestamp = Date.now();
  const header = { timestamp, expiry_window: 5000, type };
  // builder_code goes inside data object so it's included in the signature
  const dataWithBuilder = { ...data, builder_code: BUILDER_CODE };
  const combined = { ...header, data: dataWithBuilder };
  const sorted = sortJsonKeys(combined);
  return { payload: JSON.stringify(sorted), timestamp };
}

// Build final request body — flatten data fields to top level alongside account/sig
export function buildRequestBody(
  account: string,
  signature: string,
  timestamp: number,
  data: Record<string, unknown>
): Record<string, unknown> {
  return {
    account,
    agent_wallet: null,
    signature,
    timestamp,
    expiry_window: 5000,
    // builder_code also at top level in request body (docs show both)
    builder_code: BUILDER_CODE,
    ...data,
  };
}

// ── Builder code approval ─────────────────────────────────────────────────────
// Per docs: user must approve builder code before any order with builder_code works.
// Call this once per wallet (check first, only prompt if not already approved).

export async function checkBuilderApproval(wallet: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/proxy?path=${encodeURIComponent(`account/builder_codes/approvals?account=${wallet}`)}`,
      { cache: 'no-store' }
    );
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      return json.data.some(
        (a: { builder_code: string }) => a.builder_code === BUILDER_CODE
      );
    }
    return false;
  } catch {
    return false;
  }
}

export async function approveBuilderCode(
  account: string,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array | string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const timestamp = Date.now();
    const dataToSign = {
      builder_code: BUILDER_CODE,
      max_fee_rate: '0.001', // must be >= builder's fee_rate
    };
    const header = { timestamp, expiry_window: 5000, type: 'approve_builder_code' };
    const combined = { ...header, data: dataToSign };
    const sorted = sortJsonKeys(combined);
    const payload = JSON.stringify(sorted);

    const msgBytes = new TextEncoder().encode(payload);
    const sigResult = await signMessage(msgBytes);
    const sig = typeof sigResult === 'string' ? sigResult : toBase58(sigResult as Uint8Array);

    const body = {
      account,
      agent_wallet: null,
      signature: sig,
      timestamp,
      expiry_window: 5000,
      builder_code: BUILDER_CODE,
      max_fee_rate: '0.001',
    };

    const res = await fetch('https://api.pacifica.fi/api/v1/account/builder_codes/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return { success: true };
    return { success: false, error: json.error || JSON.stringify(json) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export type OrderSide = 'bid' | 'ask';
export type OrderTif = 'GTC' | 'IOC' | 'ALO' | 'TOB';

export interface LimitOrderData {
  symbol: string;
  price: string;
  amount: string;
  side: OrderSide;
  tif: OrderTif;
  reduce_only: boolean;
  leverage?: string;
  client_order_id?: string;
  take_profit?: { stop_price: string; limit_price?: string };
  stop_loss?: { stop_price: string; limit_price?: string };
}

// Base58 encode
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function toBase58(bytes: Uint8Array): string {
  let leadingZeros = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) leadingZeros++;
    else break;
  }
  const digits = [0];
  for (let bi = 0; bi < bytes.length; bi++) {
    let carry = bytes[bi];
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  while (digits.length > 1 && digits[digits.length - 1] === 0) digits.pop();
  return '1'.repeat(leadingZeros) + digits.reverse().map(d => B58_ALPHABET[d]).join('');
}

type SignFn = (msg: Uint8Array) => Promise<Uint8Array | string>;

// ── Limit Order ───────────────────────────────────────────────────────────────
export async function submitLimitOrder(
  account: string,
  data: LimitOrderData,
  signMessage: SignFn
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const orderData: Record<string, unknown> = {
      ...data,
      client_order_id: data.client_order_id || crypto.randomUUID(),
    };
    // builder_code is injected inside data by buildSigningPayload
    const { payload, timestamp } = buildSigningPayload('create_order', orderData);
    const msgBytes = new TextEncoder().encode(payload);
    const sigResult = await signMessage(msgBytes);
    const sig = typeof sigResult === 'string' ? sigResult : toBase58(sigResult as Uint8Array);
    const body = buildRequestBody(account, sig, timestamp, orderData);

    const res = await fetch('https://api.pacifica.fi/api/v1/orders/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return { success: true, orderId: json.data?.id };
    return { success: false, error: json.error || JSON.stringify(json) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ── Market Order ──────────────────────────────────────────────────────────────
// Uses create_market_order type + /orders/create_market endpoint (different from limit!)
export async function submitMarketOrder(
  account: string,
  data: Omit<LimitOrderData, 'price' | 'tif'> & { slippage_percent?: string; leverage?: string },
  signMessage: SignFn
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const orderData: Record<string, unknown> = {
      ...data,
      client_order_id: data.client_order_id || crypto.randomUUID(),
      slippage_percent: data.slippage_percent || '1',
    };
    // FIXED: market orders use 'create_market_order' type (not 'create_order')
    const { payload, timestamp } = buildSigningPayload('create_market_order', orderData);
    const msgBytes = new TextEncoder().encode(payload);
    const sigResult = await signMessage(msgBytes);
    const sig = typeof sigResult === 'string' ? sigResult : toBase58(sigResult as Uint8Array);
    const body = buildRequestBody(account, sig, timestamp, orderData);

    // FIXED: correct endpoint for market orders
    const res = await fetch('https://api.pacifica.fi/api/v1/orders/create_market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return { success: true, orderId: json.data?.id };
    return { success: false, error: json.error || JSON.stringify(json) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ── Update Builder Fee Rate ───────────────────────────────────────────────────
// Admin function: called by the builder account owner (YOU) to update fee_rate.
// This is NOT a user-facing function — only your wallet (BUILDER_WALLET) should call this.
// Docs: POST https://api.pacifica.fi/api/v1/builder/update_fee_rate

export const BUILDER_WALLET = '4YYNBTtM2kZp4XuEWTBtyRJ6F6AEyo7qTUbwdPa6QrYT';

export async function updateBuilderFeeRate(
  newFeeRate: string,          // e.g. '0.001' = 0.1%
  signMessage: SignFn
): Promise<{ success: boolean; error?: string }> {
  try {
    const dataToSign = {
      builder_code: BUILDER_CODE,
      fee_rate: newFeeRate,
    };
    const timestamp = Date.now();
    const header = { timestamp, expiry_window: 5000, type: 'update_builder_code_fee_rate' };
    // builder_code must be inside data for signing (same rule as orders)
    const combined = { ...header, data: dataToSign };
    const sorted = sortJsonKeys(combined);
    const payload = JSON.stringify(sorted);

    const msgBytes = new TextEncoder().encode(payload);
    const sigResult = await signMessage(msgBytes);
    const sig = typeof sigResult === 'string' ? sigResult : toBase58(sigResult as Uint8Array);

    // Complete payload per docs — flat structure after signing
    const body = {
      account: BUILDER_WALLET,
      agent_wallet: null,
      signature: sig,
      timestamp,
      expiry_window: 5000,
      builder_code: BUILDER_CODE,
      fee_rate: newFeeRate,
    };

    const res = await fetch('https://api.pacifica.fi/api/v1/builder/update_fee_rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return { success: true };
    return { success: false, error: json.error || JSON.stringify(json) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ── Get Builder Overview ──────────────────────────────────────────────────────
// Fetch current builder config (fee_rate, volume, trades, etc.)
// Docs: GET https://api.pacifica.fi/api/v1/builder/overview?account=WALLET

export async function getBuilderOverview(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `/api/proxy?path=${encodeURIComponent(`builder/overview?account=${BUILDER_WALLET}`)}`,
      { cache: 'no-store' }
    );
    const json = await res.json();
    return json.success ? json.data : null;
  } catch {
    return null;
  }
}
