/**
 * PacificaLens — Multi-Exchange Liquidation Worker v2
 *
 * Sources (WebSocket):
 *   1. Pacifica  — wss://ws.pacifica.fi/ws
 *   2. Binance   — wss://fstream.binance.com/ws/!forceOrder@arr
 *   3. Bybit     — wss://stream.bybit.com/v5/public/linear  (liquidation)
 *   4. OKX       — wss://ws.okx.com:8443/ws/v5/public       (liquidation-orders)
 *   5. Hyperliquid — wss://api.hyperliquid.xyz/ws            (activeAssetCtx → fills)
 *
 * Improvements over v1:
 *   - 7-day retention (was 24h)
 *   - All major exchanges aggregated
 *   - Symbol normalization to BTC-USD format
 *   - Per-source reconnect with exponential backoff
 *   - Shared dedup + flush pipeline
 */

const { WebSocket } = require('ws');
const http = require('http');

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
const PORT          = process.env.PORT || 3000;
const PACIFICA_API  = 'https://api.pacifica.fi/api/v1';

const FLUSH_MS      = 5_000;
const CLEANUP_MS    = 6 * 60 * 60 * 1000; // every 6h
const RETENTION_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
const SELF_PING_MS  = 10 * 60 * 1000;
const MIN_NOTIONAL  = 100; // ignore tiny liquidations < $100

// ── Shared State ──────────────────────────────────────────────────────────────
let pendingLiqs = [];
const seenIds   = new Set(); // global dedup across all sources
const flushedIds= new Set();

// ── Symbol Normalisation ──────────────────────────────────────────────────────
// All symbols stored as "BTC-USD", "ETH-USD", etc.
function normalizeSymbol(raw = '') {
  let s = raw.toUpperCase().trim();
  // Binance: BTCUSDT → BTC-USD
  s = s.replace(/USDT$/, '-USD').replace(/BUSD$/, '-USD').replace(/USD$/, '-USD');
  // OKX: BTC-USDT-SWAP → BTC-USD
  s = s.replace(/-USDT-SWAP$/, '-USD').replace(/-USD-SWAP$/, '-USD').replace(/-USDT$/, '-USD');
  // Bybit: BTCUSDT → BTC-USD (already handled above)
  // Hyperliquid: BTC → BTC-USD
  if (!s.includes('-')) s = s + '-USD';
  return s;
}

// ── Dedup + Buffer ────────────────────────────────────────────────────────────
function addLiq({ source, tradeId, symbol, side, cause, price, amount, notional, ts }) {
  if (!notional || notional < MIN_NOTIONAL) return;
  const id = tradeId || `${source}-${symbol}-${ts}-${Math.round(price * 1000)}`;
  if (seenIds.has(id)) return;
  seenIds.add(id);
  if (seenIds.size > 20000) {
    const first = seenIds.values().next().value;
    seenIds.delete(first);
  }
  pendingLiqs.push({
    trade_id: id,
    symbol:   normalizeSymbol(symbol),
    side:     side || 'unknown',
    cause:    cause || source,
    price,
    amount:   amount || notional / price,
    notional,
    source,
    ts: new Date(typeof ts === 'number' ? (ts > 1e12 ? ts : ts * 1000) : ts).toISOString(),
  });
}

// ── Supabase Flush ────────────────────────────────────────────────────────────
async function flushToSupabase() {
  if (!pendingLiqs.length) return;
  const rows = pendingLiqs.filter(r => !flushedIds.has(r.trade_id));
  pendingLiqs = [];
  if (!rows.length) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/liquidations`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    rows.forEach(r => {
      flushedIds.add(r.trade_id);
      if (flushedIds.size > 10000) flushedIds.delete(flushedIds.values().next().value);
    });
    if (res.ok) console.log(`[flush] ${rows.length} rows → Supabase (${JSON.stringify(rows.reduce((a,r)=>{a[r.source]=(a[r.source]||0)+1;return a;},{}))})`);
  } catch (e) {
    console.error('[flush] error:', e.message);
    pendingLiqs.push(...rows); // re-queue
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  const since = new Date(Date.now() - RETENTION_MS).toISOString();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/liquidations?ts=lt.${since}`, {
      method: 'DELETE',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    console.log(`[cleanup] Deleted rows older than 7d (status ${res.status})`);
  } catch (e) {
    console.error('[cleanup] error:', e.message);
  }
}

// ── Generic WS reconnect wrapper ──────────────────────────────────────────────
function makeWS({ name, url, onOpen, onMessage, pingMsg, pingMs = 20000 }) {
  let ws = null;
  let retryDelay = 2000;
  let pingInterval = null;

  function connect() {
    console.log(`[${name}] Connecting to ${url}`);
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log(`[${name}] Connected`);
      retryDelay = 2000;
      if (onOpen) onOpen(ws);
      if (pingMsg) {
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pingMsg));
        }, pingMs);
      }
    });

    ws.on('message', (data) => {
      try { onMessage(JSON.parse(data)); } catch {}
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      console.log(`[${name}] Disconnected — retry in ${retryDelay}ms`);
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 1.5, 30000);
    });

    ws.on('error', (e) => console.error(`[${name}] WS error:`, e.message));
  }

  connect();
  return () => ws; // getter
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 1: Pacifica
// ─────────────────────────────────────────────────────────────────────────────
let pacificaSymbols = [];

async function fetchPacificaSymbols() {
  try {
    const res = await fetch(`${PACIFICA_API}/info`);
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      pacificaSymbols = json.data.map(m => m.symbol);
      console.log(`[pacifica] Loaded ${pacificaSymbols.length} markets`);
    }
  } catch (e) {
    console.error('[pacifica] symbol fetch error:', e.message);
  }
}

function startPacifica() {
  makeWS({
    name: 'pacifica',
    url:  'wss://ws.pacifica.fi/ws',
    pingMsg: { method: 'ping' },
    onOpen: (ws) => {
      for (const sym of pacificaSymbols) {
        const wsSym = sym.replace(/-USD$/, '');
        ws.send(JSON.stringify({ method: 'subscribe', params: { source: 'trades', symbol: wsSym } }));
      }
    },
    onMessage: (msg) => {
      if (msg.channel !== 'trades' || !Array.isArray(msg.data)) return;
      for (const t of msg.data) {
        const isLiq = t.tc === 'market_liquidation'
          || t.tc === 'backstop_liquidation'
          || (typeof t.tc === 'string' && t.tc.toLowerCase().includes('liq'));
        if (!isLiq) continue;
        const price    = parseFloat(t.p) || 0;
        const amount   = parseFloat(t.a) || 0;
        addLiq({
          source:   'pacifica',
          tradeId:  `pac-${t.s}-${t.h}-${t.t}`,
          symbol:   t.s?.includes('-') ? t.s : (t.s + '-USD'),
          side:     t.d || 'unknown',
          cause:    t.tc,
          price,
          amount,
          notional: price * amount,
          ts:       t.t,
        });
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 2: Binance Futures — !forceOrder@arr
// Provides ALL force (liquidation) orders across all perp pairs
// ─────────────────────────────────────────────────────────────────────────────
function startBinance() {
  makeWS({
    name: 'binance',
    url:  'wss://fstream.binance.com/ws/!forceOrder@arr',
    onMessage: (msg) => {
      // msg = { e: 'forceOrder', E: timestamp, o: { s, S, q, p, ap, ... } }
      const e = msg.e === 'forceOrder' ? msg : null;
      if (!e) return;
      const o = e.o;
      if (!o) return;
      const price    = parseFloat(o.ap || o.p) || 0; // average price or order price
      const amount   = parseFloat(o.q)  || 0;
      const notional = price * amount;
      // S = side of the order being liquidated: BUY = short position liquidated, SELL = long position liquidated
      const side = o.S === 'BUY' ? 'short_liquidation' : 'long_liquidation';
      addLiq({
        source:   'binance',
        tradeId:  `bnb-${o.s}-${e.E}-${o.T}`,
        symbol:   o.s,
        side,
        cause:    'liquidation',
        price,
        amount,
        notional,
        ts:       e.E || Date.now(),
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 3: Bybit — liquidation stream
// ─────────────────────────────────────────────────────────────────────────────
// Top perp symbols to subscribe on Bybit (all USDT perps would need REST lookup)
const BYBIT_SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT',
  'AVAXUSDT','LINKUSDT','BNBUSDT','LTCUSDT','ADAUSDT',
  'MATICUSDT','DOTUSDT','UNIUSDT','ATOMUSDT','NEARUSDT',
  'FILUSDT','AAVEUSDT','APTUSDT','ARBUSDT','OPUSDT',
  'INJUSDT','SUIUSDT','TIAUSDT','SEIUSDT','WIFUSDT',
  'PEPEUSDT','SHIBUSDT','FLOKIUSDT','ORDIUSDT','STXUSDT',
];

function startBybit() {
  makeWS({
    name: 'bybit',
    url:  'wss://stream.bybit.com/v5/public/linear',
    pingMsg: { op: 'ping' },
    onOpen: (ws) => {
      // Subscribe in batches of 10
      const topics = BYBIT_SYMBOLS.map(s => `liquidation.${s}`);
      for (let i = 0; i < topics.length; i += 10) {
        ws.send(JSON.stringify({ op: 'subscribe', args: topics.slice(i, i + 10) }));
      }
    },
    onMessage: (msg) => {
      if (msg.topic?.startsWith('liquidation.') && msg.data) {
        const d = msg.data;
        const price    = parseFloat(d.price)  || 0;
        const size     = parseFloat(d.size)   || 0;
        const notional = price * size;
        // side: Buy = long position liquidated, Sell = short position liquidated
        const side = d.side === 'Buy' ? 'long_liquidation' : 'short_liquidation';
        addLiq({
          source:   'bybit',
          tradeId:  `bbt-${d.symbol}-${msg.ts}-${Math.round(price*100)}`,
          symbol:   d.symbol,
          side,
          cause:    'liquidation',
          price,
          amount:   size,
          notional,
          ts:       msg.ts || Date.now(),
        });
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 4: OKX — liquidation-orders channel
// ─────────────────────────────────────────────────────────────────────────────
const OKX_SYMBOLS = [
  'BTC-USDT-SWAP','ETH-USDT-SWAP','SOL-USDT-SWAP','XRP-USDT-SWAP',
  'DOGE-USDT-SWAP','AVAX-USDT-SWAP','LINK-USDT-SWAP','BNB-USDT-SWAP',
  'ADA-USDT-SWAP','DOT-USDT-SWAP','MATIC-USDT-SWAP','NEAR-USDT-SWAP',
  'UNI-USDT-SWAP','ATOM-USDT-SWAP','APT-USDT-SWAP','ARB-USDT-SWAP',
  'OP-USDT-SWAP','INJ-USDT-SWAP','SUI-USDT-SWAP','TIA-USDT-SWAP',
];

function startOKX() {
  makeWS({
    name: 'okx',
    url:  'wss://ws.okx.com:8443/ws/v5/public',
    pingMsg: 'ping', // OKX uses plain string ping
    onOpen: (ws) => {
      const args = OKX_SYMBOLS.map(instId => ({ channel: 'liquidation-orders', instId }));
      // Subscribe in batches
      for (let i = 0; i < args.length; i += 10) {
        ws.send(JSON.stringify({ op: 'subscribe', args: args.slice(i, i + 10) }));
      }
    },
    onMessage: (msg) => {
      if (msg === 'pong') return;
      if (msg.arg?.channel !== 'liquidation-orders') return;
      const details = msg.data?.[0]?.details;
      if (!Array.isArray(details)) return;
      const instId = msg.arg.instId;
      for (const d of details) {
        const price    = parseFloat(d.bkPx)  || 0; // bankruptcy price
        const size     = parseFloat(d.sz)    || 0;
        const notional = price * size;
        // posSide: long = long position being liquidated
        const side = d.posSide === 'long' ? 'long_liquidation' : 'short_liquidation';
        addLiq({
          source:   'okx',
          tradeId:  `okx-${instId}-${d.ts}-${Math.round(price*100)}`,
          symbol:   instId,
          side,
          cause:    'liquidation',
          price,
          amount:   size,
          notional,
          ts:       parseInt(d.ts) || Date.now(),
        });
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 5: Hyperliquid — userFills via allMids subscription
// Hyperliquid WebSocket provides liquidation events in the fills channel
// ─────────────────────────────────────────────────────────────────────────────
function startHyperliquid() {
  makeWS({
    name: 'hyperliquid',
    url:  'wss://api.hyperliquid.xyz/ws',
    pingMsg: { method: 'ping' },
    onOpen: (ws) => {
      // Subscribe to all liquidations feed
      ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'liquidations' },
      }));
    },
    onMessage: (msg) => {
      // Hyperliquid liquidation event format
      if (msg.channel === 'liquidations' && msg.data) {
        const d = msg.data;
        const price    = parseFloat(d.px)   || 0;
        const size     = parseFloat(d.sz)   || 0;
        const notional = price * size;
        const side     = d.dir?.includes('Long') ? 'long_liquidation' : 'short_liquidation';
        addLiq({
          source:   'hyperliquid',
          tradeId:  `hl-${d.coin}-${d.time}-${Math.round(price*100)}`,
          symbol:   d.coin,
          side,
          cause:    'liquidation',
          price,
          amount:   size,
          notional,
          ts:       d.time || Date.now(),
        });
      }
      // Also catch fills with liq flag
      if (msg.channel === 'fills' && Array.isArray(msg.data)) {
        for (const fill of msg.data) {
          if (!fill.liquidation) continue;
          const price    = parseFloat(fill.px)  || 0;
          const size     = parseFloat(fill.sz)  || 0;
          const notional = price * size;
          const side     = fill.dir?.includes('Long') ? 'long_liquidation' : 'short_liquidation';
          addLiq({
            source:   'hyperliquid',
            tradeId:  `hl-fill-${fill.coin}-${fill.time}-${Math.round(price*100)}`,
            symbol:   fill.coin,
            side,
            cause:    'liquidation',
            price,
            amount:   size,
            notional,
            ts:       fill.time || Date.now(),
          });
        }
      }
    },
  });
}

// ── HTTP Status Server ────────────────────────────────────────────────────────
function startHttpServer() {
  const startTime = Date.now();
  const counters = { pacifica: 0, binance: 0, bybit: 0, okx: 0, hyperliquid: 0 };

  // Patch addLiq to count per source
  const _orig = addLiq;
  // (counters tracked via pendingLiqs source field)

  const server = http.createServer((req, res) => {
    const sourceCounts = pendingLiqs.reduce((a, r) => {
      a[r.source] = (a[r.source] || 0) + 1;
      return a;
    }, {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status:   'ok',
      uptime:   Math.floor((Date.now() - startTime) / 1000) + 's',
      pending:  pendingLiqs.length,
      seen:     seenIds.size,
      flushed:  flushedIds.size,
      pending_by_source: sourceCounts,
      sources:  ['pacifica', 'binance', 'bybit', 'okx', 'hyperliquid'],
    }, null, 2));
  });
  server.listen(PORT, () => console.log(`[http] Status server on port ${PORT}`));
}

function startSelfPing() {
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (!RENDER_URL) { console.log('[self-ping] RENDER_EXTERNAL_URL not set, skipping'); return; }
  setInterval(async () => {
    try {
      await fetch(RENDER_URL);
      console.log('[self-ping] OK');
    } catch (e) {
      console.error('[self-ping] error:', e.message);
    }
  }, SELF_PING_MS);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[main] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
  }

  console.log('[main] Starting PacificaLens Multi-Exchange Liquidation Worker v2');
  console.log('[main] Sources: Pacifica + Binance + Bybit + OKX + Hyperliquid');
  console.log(`[main] Retention: 7 days | Flush interval: ${FLUSH_MS}ms`);

  startHttpServer();

  // Fetch Pacifica markets before starting WS
  await fetchPacificaSymbols();

  // Start all WebSocket sources
  startPacifica();
  startBinance();
  startBybit();
  startOKX();
  startHyperliquid();

  // Flush buffer every 5 seconds
  setInterval(flushToSupabase, FLUSH_MS);

  // Cleanup old rows every 6 hours
  setInterval(cleanup, CLEANUP_MS);
  cleanup(); // immediate cleanup on start

  startSelfPing();

  // Refresh Pacifica symbols every 6 hours
  setInterval(fetchPacificaSymbols, 6 * 60 * 60 * 1000);

  console.log('[main] All sources started. Waiting for liquidation events...');
}

main();
