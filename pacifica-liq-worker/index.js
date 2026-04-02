/**
 * PacificaLens — Liquidation Worker
 * Runs on Render.com free tier
 * - Connects to Pacifica WebSocket
 * - Detects liquidation events
 * - Writes to Supabase
 * - Auto-reconnects on disconnect
 * - Self-pings to prevent Render sleep
 */

const { WebSocket } = require('ws');
const http = require('http');

const PACIFICA_WS   = 'wss://ws.pacifica.fi/ws';
const PACIFICA_API  = 'https://api.pacifica.fi/api/v1';
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
const PORT          = process.env.PORT || 3000;

const PING_MS       = 25_000;  // WS keepalive
const RECONNECT_MS  = 3_000;   // reconnect delay
const FLUSH_MS      = 5_000;   // batch write every 5s
const CLEANUP_MS    = 60 * 60 * 1000; // cleanup every 1h

let ws = null;
let symbols = [];
let pendingLiqs = [];  // buffer — flush to Supabase every 5s
const seenIds = new Set();

// ── Fetch all market symbols ──────────────────────────────────────────────────
async function fetchSymbols() {
  try {
    const res = await fetch(`${PACIFICA_API}/info`);
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      symbols = json.data.map(m => m.symbol);
      console.log(`[symbols] Loaded ${symbols.length} markets`);
    }
  } catch (e) {
    console.error('[symbols] Error:', e.message);
  }
}

// ── Upsert liquidations to Supabase ──────────────────────────────────────────
async function flushToSupabase() {
  if (!pendingLiqs.length) return;
  const rows = [...pendingLiqs];
  pendingLiqs = [];

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/liquidations`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=ignore-duplicates',
      },
      body: JSON.stringify(rows),
    });
    if (res.ok) {
      console.log(`[supabase] Inserted ${rows.length} liquidations`);
    } else {
      const txt = await res.text();
      console.error(`[supabase] Error ${res.status}: ${txt}`);
      // Put back on failure
      pendingLiqs.push(...rows);
    }
  } catch (e) {
    console.error('[supabase] Fetch error:', e.message);
    pendingLiqs.push(...rows);
  }
}

// ── Cleanup rows older than 24h ───────────────────────────────────────────────
async function cleanup() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/liquidations?ts=lt.${since}`, {
      method: 'DELETE',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    console.log('[cleanup] Deleted rows older than 24h');
  } catch (e) {
    console.error('[cleanup] Error:', e.message);
  }
}

// ── WebSocket connection ──────────────────────────────────────────────────────
function connect() {
  if (ws) { try { ws.terminate(); } catch {} }

  console.log('[ws] Connecting...');
  ws = new WebSocket(PACIFICA_WS);

  ws.on('open', () => {
    console.log(`[ws] Connected — subscribing to ${symbols.length} markets`);
    // Subscribe all symbols
    for (const sym of symbols) {
      const wsSym = sym.replace(/-USD$/, '');
      ws.send(JSON.stringify({ method: 'subscribe', params: { source: 'trades', symbol: wsSym } }));
    }
    // Keepalive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method: 'ping' }));
      } else {
        clearInterval(pingInterval);
      }
    }, PING_MS);
  });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.channel !== 'trades' || !Array.isArray(msg.data)) return;

    for (const raw of msg.data) {
      const isLiq = raw.tc === 'market_liquidation'
        || raw.tc === 'backstop_liquidation'
        || (typeof raw.tc === 'string' && raw.tc.toLowerCase().includes('liq'));
      if (!isLiq) continue;

      const symbol   = raw.s?.includes('-') ? raw.s : (raw.s + '-USD');
      const price    = parseFloat(raw.p) || 0;
      const amount   = parseFloat(raw.a) || 0;
      const notional = price * amount;
      if (!notional || notional < 1) continue;

      const ts      = raw.t > 1e12 ? raw.t : raw.t * 1000;
      const tradeId = `${symbol}-${raw.h}-${raw.t}`;

      if (seenIds.has(tradeId)) continue;
      seenIds.add(tradeId);
      if (seenIds.size > 10000) {
        const first = seenIds.values().next().value;
        seenIds.delete(first);
      }

      const row = {
        trade_id: tradeId,
        symbol,
        side:     raw.d || 'unknown',
        cause:    raw.tc,
        price,
        amount,
        notional,
        ts: new Date(ts).toISOString(),
      };

      pendingLiqs.push(row);
      console.log(`[liq] ${symbol} ${raw.d} $${notional.toFixed(0)} (${raw.tc})`);
    }
  });

  ws.on('close', () => {
    console.log(`[ws] Disconnected — reconnecting in ${RECONNECT_MS}ms`);
    setTimeout(connect, RECONNECT_MS);
  });

  ws.on('error', (e) => {
    console.error('[ws] Error:', e.message);
  });
}

// ── Self-ping HTTP server (prevents Render sleep) ─────────────────────────────
function startHttpServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status:  'ok',
      markets: symbols.length,
      pending: pendingLiqs.length,
      seen:    seenIds.size,
      uptime:  Math.floor(process.uptime()) + 's',
    }));
  });
  server.listen(PORT, () => console.log(`[http] Server on port ${PORT}`));
}

// Self-ping every 10 minutes so Render doesn't sleep
function startSelfPing() {
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (!RENDER_URL) { console.log('[self-ping] RENDER_EXTERNAL_URL not set, skipping'); return; }

  setInterval(async () => {
    try {
      await fetch(RENDER_URL);
      console.log('[self-ping] OK');
    } catch (e) {
      console.error('[self-ping] Error:', e.message);
    }
  }, 10 * 60 * 1000);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
  }

  startHttpServer();
  await fetchSymbols();

  if (!symbols.length) {
    console.error('No symbols loaded, retrying in 10s...');
    setTimeout(main, 10_000);
    return;
  }

  connect();

  // Flush buffer to Supabase every 5 seconds
  setInterval(flushToSupabase, FLUSH_MS);

  // Cleanup old rows every hour
  setInterval(cleanup, CLEANUP_MS);
  cleanup(); // run immediately on start

  startSelfPing();
}

main();
