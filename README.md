<div align="center">
  <img src="public/logo.png" alt="PacificaLens Logo" width="90" />

  <h1>PacificaLens</h1>

  <p><strong>The all-in-one analytics & trading intelligence platform for <a href="https://app.pacifica.fi">Pacifica.fi</a></strong></p>

  <p>
    <a href="https://www.pacificalens.xyz">🌐 Live App</a> ·
    <a href="https://app.pacifica.fi">Pacifica DEX</a> ·
    <a href="https://pacifica.fi">Pacifica Hackathon 2026</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript" />
    <img src="https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss" />
    <img src="https://img.shields.io/badge/Solana-Privy-9945FF?logo=solana" />
    <img src="https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase" />
    <img src="https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel" />
  </p>
</div>

---

## What is PacificaLens?

PacificaLens is a comprehensive real-time trading intelligence dashboard built natively on top of [Pacifica DEX](https://app.pacifica.fi) — a decentralized perpetuals exchange on Solana. It transforms raw exchange data into actionable insights by combining whale tracking, funding-rate arbitrage, copy trading with live position mirroring, AI-powered market analysis, liquidation heatmaps, portfolio management, and precision risk calculation — all in one authenticated interface.

**Live at → [https://www.pacificalens.xyz](https://www.pacificalens.xyz)**

Built for the **Pacifica Hackathon 2026** using the Pacifica Builder API.

---

## Core Philosophy

> "See what smart money sees. Trade with precision. Never miss a signal."

Every module is designed around a real trading workflow need — from pre-trade risk sizing to post-trade portfolio review, with real-time market intelligence feeding every decision.

---

## Features

### 🌍 Interactive Globe Landing Page

The entry point is a Three.js 3D globe rendered in WebGL with a deep-space nebula background, multi-layered star field, and atmospheric glow effects.

- Drag to rotate, scroll to zoom
- Click anywhere on the globe to **drop a location pin** — stored in Supabase, visible to all users worldwide
- Connect Solana wallet directly from the landing page via Privy (Phantom, Solflare, Backpack)
- Feature strip and Hackathon 2026 badge before entering the dashboard

---

### 📊 Market Overview

Real-time intelligence for all **63 Pacifica perpetual markets**.

**Market Table:**
- Live prices, 24h % change, funding rate, volume, open interest — updating via WebSocket every 30s
- Color-coded funding rates: positive = shorts paid, negative = longs paid
- Sparkline mini-charts (4h candles, 4-day window) per row
- Sortable and filterable by any column
- Favorites / Gainers / Losers quick tabs
- Click any row to open the **Market Detail Panel**

**Market Detail Panel:**
- Full bid/ask orderbook with depth visualization
- Recent trades feed (liquidations tagged separately)
- Interactive candlestick chart (1m → 1d)
- One-click trade execution directly from the panel

**Top Stats Bar:**
- Fear & Greed Index
- Altcoin Season Index
- Top 3 gainers and losers

---

### ⚖️ Risk Manager

A professional position sizing calculator built for disciplined perpetuals trading.

**Inputs:**
- Account size (auto-fills from wallet equity)
- Risk % per trade (slider with real-dollar equivalent)
- Entry price (auto-fills from mark price)
- Stop loss (quick buttons: −1% / −2% / −3% / −5%)
- Take profit (R:R ratio or manual price)
- Leverage (slider, 1× → market max)
- Long / Short toggle

**Outputs:**
- Exact position size in contracts
- Position value in USD
- Required margin
- Estimated liquidation price
- Max loss in USD and %
- TP levels at 1:1, 1:2, 1:3 R:R
- Expected Value calculation
- Daily and weekly funding cost estimate
- Visual price level diagram (Liq → SL → Entry → TP)

**Portfolio Risk Tab:**
- Aggregates all open positions
- Total margin used, combined risk %, unrealized PnL
- Bubble chart by symbol and position size
- Long/short ratio bar across the portfolio

**Execute:** Places a real order on Pacifica via Builder Code with one click, straight from the calculator results.

---

### ⚡ Funding Rate Arbitrage Scanner

Find and exploit funding rate differentials across perpetual exchanges for delta-neutral yield.

**How it works:**
1. Go LONG on the exchange with lower (or negative) funding
2. Go SHORT on the exchange with higher funding
3. Price risk cancels out — collect the spread 3× per day (every 8h)

**Cross-exchange comparison:**
- Pacifica vs Hyperliquid
- Pacifica vs dYdX
- Pacifica vs Aster
- All combinations at once

**Opportunity display:**
- Spread per 8h and annualized APR
- Tier badges: 🔥 HIGH (≥50% APR) / MEDIUM (20–50%) / LOW (<20%)
- Exact LONG/SHORT exchange per strategy
- Sort by APR, symbol, or spread

**Arbitrage Alert Bot:**
- Set minimum APR threshold
- Connect Telegram bot or Discord webhook
- Receive alerts when new opportunities cross your threshold
- Check interval: 5 / 10 / 30 minutes
- Activity log of the last 20 sent alerts

---

### 🐋 Whale Watcher

Monitor large trades and liquidation events across all Pacifica markets in real time.

**Whale Trade Feed:**
- WebSocket scan every 5 seconds across all 63 markets
- Displays every trade above your threshold (default $10K notional)
- Shows: symbol, side (long/short open/close), notional, price, timestamp
- Liquidation events tagged separately with ⚡

**Symbol Pressure Map:**
- Per-symbol bull/bear score (0–100) based on aggregated whale flow
- Long vs short notional comparison bar
- Liquidation count split (long liq vs short liq)
- OI change % and funding spike flags
- Sort by: total flow, bull score, trade count, liquidations

**Wallet Lookup:**
- Enter any Solana address → see their Pacifica trade history, active positions, and PnL

---

### 👥 Smart Money Leaderboard & Copy Trading

**Leaderboard (7,800+ tracked traders):**

| Column | Description |
|--------|-------------|
| Score | Proprietary 0–100 composite (see below) |
| PnL 7D / 30D / All Time | Realized + unrealized PnL |
| Vol 7D / 30D / All Time | Trading volume |
| Equity | Current account equity |
| Open Int. | Current open position notional |
| Style | Trader classification |

**Trader Score System v3:**

Composite 0–100 score calculated from 8 weighted components:

| Component | Max | Description |
|-----------|-----|-------------|
| PnL | 20 | Percentile rank of 30d PnL vs all active traders |
| Consistency | 20 | 7d vs 30d momentum alignment |
| EPR | 15 | Exposure Profit Ratio — PnL relative to OI |
| Win Rate | 15 | Long-term PnL / volume efficiency proxy |
| Drawdown | 10 | Recent loss control vs overall gains |
| OI Risk | 5 | OI/equity ratio — high leverage penalized |
| Track Record | 10 | All-time PnL size and long-term profitability |
| Cap. Efficiency | 5 | 30d PnL relative to current equity |

**Key rules:**
- `volume_30d = 0` → score 0 automatically (inactive accounts excluded)
- Tier thresholds are **dynamic** (percentile-based): S = top 5%, A = top 20%, B = top 45%, C = rest

**Trader Styles:**
- 🔥 High Risk — OI/equity >5× or losing all-time with high volume
- 🐋 Whale — volume >$5M/month or equity >$500K
- ⚡ Scalper — >55% of monthly volume concentrated in 7 days
- 📈 Swing Trader — moderate churn, positive 30d PnL
- ⚖️ Balanced — everything else

**Trader Modal (click any row):**
- Full trade history with PnL per trade
- Active positions
- Equity sparkline over time
- Score breakdown bar chart with tooltips explaining each metric

**Copy Trading:**
- Watch a trader → automatically mirror their positions in real time
- Configure: copy ratio (% of their size), max position size, allowed symbols, delay
- Supports partial close mirroring (trader reduces 30%+ → your position reduces proportionally)
- Stop copying at any time without auto-closing your positions
- Watching tab filters to only your followed traders

---

### 🔥 Liquidation Heatmap

A real-time and historical liquidation visualization system, unique to PacificaLens.

**Grid View (in Analytics tab):**
- All 63 coins as clickable tiles
- Tiles with real liquidations: **red** = long liq dominant, **green** = short liq dominant
- Tiles with no liquidations: **blue tint** scaled by Open Interest — potential risk zones
- Refreshes every 2 minutes from Supabase; cached in localStorage

**Detail Modal (click any tile):**
- Coinglass-style canvas heatmap: X = time buckets, Y = price levels
- Short liq zones: red/orange/yellow heat above price line
- Long liq zones: cyan/green heat below price line
- **Real liquidation dots** from Supabase — size = notional, color = side
- Price line overlay (actual price movement)
- Crosshair + rich tooltip on hover
- Range filter: 12h / 24h / 48h / 7d
- Side filter: All / Long / Short

**Data Infrastructure:**
- A persistent Node.js worker on Render.com connects to `wss://ws.pacifica.fi/ws` 24/7
- Every `market_liquidation` and `backstop_liquidation` event is batched and upserted to Supabase within 5 seconds
- Supabase maintains a 24-hour rolling window (rows older than 24h auto-deleted hourly)
- Site visitors also contribute: their WebSocket connection writes liquidations while the app is open

---

### 🤖 AI Assistant

An intelligent market assistant powered by a dual-model routing architecture.

**Routing logic:**
- **Elfa AI** → social/sentiment queries: trending tokens, Twitter buzz, whale narratives (15-min cache)
- **Groq (Llama 3.3 70B)** → everything else: market analysis, DeFi concepts, risk calculations (30-min cache)

**Live context:** Current Pacifica mark prices are injected into every query — the AI always answers with real market data, never stale training data.

**What you can ask:**
- "What's the current funding rate on SOL?"
- "Explain how perpetual funding works"
- "What's my liquidation price if I long BTC at $66,000 with 10x leverage and $500 margin?"
- "Which tokens are whales accumulating?"
- "Is 2% risk per trade too much for a $1,000 account?"

---

### 📈 Analytics Tab

Deep market analytics for the entire Pacifica ecosystem.

- AI Assistant panel (collapsible)
- Funding Rate Heatmap — all markets, color-coded, live
- Market Signals — OI spike alerts (≥2% change) and funding spike alerts
- Volume by Market — top 10 horizontal bar chart
- OI Distribution — donut chart with center label showing total
- Long/Short Ratio — per-symbol bias bar
- 24h Volume Dominance — percentage breakdown
- Recent Liquidations — live WebSocket feed, filterable by size
- Liquidation Heatmap grid
- Global News — aggregated crypto news with category filter
- Economic Calendar — ForexFactory events for current + next week

---

### 💼 Portfolio

Full account management for the connected wallet.

**Positions tab:**
- All open perpetual positions with live mark price, unrealized PnL, ROI%, entry price, liquidation price
- **Close button** per row — places a reduce-only market order instantly

**Open Orders tab:**
- All pending limit orders
- **Cancel button** per row — cancels via signed Pacifica API call

**Other tabs:**
- Trade History — full execution history with realized PnL per trade
- Funding History — all funding payments with rate and timestamp
- Order Log — all orders placed through PacificaLens
- Copy Performance — copy trading activity summary
- Price Alerts — manage all active alerts
- Journal — personal trade journal (symbol, side, notes, result, PnL) stored locally
- Performance — aggregated stats: win rate, profit factor, average win/loss, daily/weekly PnL

---

### 🔔 Price Alerts

- Set trigger above/below for any of the 63 markets
- Browser push notification support
- Alerts persist in localStorage
- Enable/disable without deleting

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   FRONTEND                      │
│  Next.js 14 · TypeScript · Tailwind CSS         │
│  Deployed on Vercel                             │
└──────────────┬──────────────┬───────────────────┘
               │              │
    ┌──────────┼──────────┐   │
    ▼          ▼          ▼   ▼
┌────────┐ ┌────────┐ ┌──────────────────┐
│Pacifica│ │Supabase│ │ External APIs    │
│REST+WSS│ │Postgres│ │ Groq · Elfa      │
│63 mkts │ │        │ │ News · Calendar  │
└────────┘ └───┬────┘ └──────────────────┘
               │
       ┌───────┴──────────┐
       │  Render Worker   │
       │  Node.js 18      │
       │  24/7 WSS conn   │
       │  → liquidations  │
       └──────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + CSS custom properties |
| Auth | Privy (`@privy-io/react-auth`) |
| Blockchain | Solana (`@solana/web3.js`, `bs58`, `tweetnacl`) |
| Market Data | Pacifica REST API + WebSocket |
| Charts | Recharts, Canvas 2D (heatmap), Three.js (globe) |
| AI Social | Elfa AI v2 |
| AI General | Groq API (Llama 3.3 70B Versatile) |
| Database | Supabase (PostgreSQL) |
| Worker | Node.js on Render.com |
| Deployment | Vercel (Hobby) |

---

## Project Structure

```
PacificaLens/
├── src/
│   ├── app/
│   │   ├── page.tsx                      # Landing — globe + wallet connect
│   │   ├── layout.tsx                    # Root layout — Privy provider
│   │   ├── globals.css                   # Theme variables (dark/light)
│   │   ├── overview/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── risk/page.tsx
│   │   ├── arbitrage/page.tsx
│   │   ├── arbitrage/bot/page.tsx
│   │   ├── smart-money/page.tsx
│   │   ├── portfolio/page.tsx
│   │   └── api/
│   │       ├── ai/route.ts               # Groq/Elfa router
│   │       ├── calendar/route.ts         # Economic calendar proxy
│   │       ├── hyperliquid/route.ts      # Hyperliquid funding proxy
│   │       ├── dydx/route.ts             # dYdX funding proxy
│   │       ├── aster/route.ts            # Aster exchange proxy
│   │       ├── news/route.ts             # Crypto news aggregator
│   │       ├── pins/route.ts             # Globe pins (Supabase)
│   │       ├── proxy/route.ts            # Pacifica API CORS proxy
│   │       └── liquidations/
│   │           ├── route.ts              # GET aggregated + POST write
│   │           └── recent/route.ts       # GET individual events (heatmap modal)
│   ├── components/
│   │   ├── AppShell.tsx                  # Global state, routing, order execution
│   │   ├── Header.tsx                    # Navigation + wallet info
│   │   ├── Overview.tsx                  # Market table + detail panel
│   │   ├── RiskManager.tsx               # Position calculator + portfolio risk
│   │   ├── Calculator.tsx                # Risk calc form
│   │   ├── Results.tsx                   # Calc output + execute
│   │   ├── Arbitrage.tsx                 # Arbitrage scanner
│   │   ├── ArbitrageScanner.tsx          # Multi-exchange scanner + glossary
│   │   ├── WhaleWatcher.tsx              # Whale feed + pressure map
│   │   ├── CopyTrading.tsx               # Leaderboard + copy settings
│   │   ├── TraderModal.tsx               # Trader deep-dive drawer
│   │   ├── Analytics.tsx                 # All analytics + heatmap grid
│   │   ├── LiquidationHeatmapModal.tsx   # Coinglass-style heatmap modal
│   │   ├── AiAssistant.tsx               # AI chat component
│   │   ├── Portfolio.tsx                 # Portfolio + close/cancel + journal
│   │   ├── GlobeMap.tsx                  # Three.js interactive globe
│   │   ├── ScoreBadge.tsx                # Trader score badge + score card
│   │   ├── PriceAlerts.tsx               # Alert management UI
│   │   ├── TradingPanel.tsx              # Trade execution panel
│   │   ├── CoinLogo.tsx                  # Coin icon with fallback
│   │   ├── ConnectScreen.tsx             # Pre-auth landing content
│   │   ├── ConnectWalletButton.tsx       # Privy connect button
│   │   ├── EarlyAccessGate.tsx           # Whitelist gate
│   │   └── Toast.tsx                     # Toast notifications
│   ├── hooks/
│   │   ├── useWhaleWatcher.ts            # Real-time whale WebSocket hook
│   │   ├── useLiquidationHeatmap.ts      # 24h liq data from Supabase
│   │   ├── useCopyTrading.ts             # Leaderboard + copy state
│   │   ├── usePositionMirror.ts          # Auto-copy mirroring engine
│   │   ├── useArbitrage.ts               # Multi-exchange funding fetcher
│   │   ├── useAccount.ts                 # Account info + positions
│   │   ├── useMarkets.ts                 # Market list cache
│   │   ├── usePriceAlerts.ts             # Alert state + notifications
│   │   ├── useOrderLog.ts                # Order history logger
│   │   └── useTheme.ts                   # Dark/light theme toggle
│   └── lib/
│       ├── pacifica.ts                   # Pacifica REST API client
│       ├── pacificaSigning.ts            # Signing + Builder Code + cancel/close
│       ├── traderScore.ts                # Trader scoring algorithm v3
│       ├── utils.ts                      # Formatters (price, PnL, time)
│       └── ai/
│           ├── router.ts                 # Groq/Elfa routing logic
│           ├── elfa.ts                   # Elfa AI client
│           ├── groq.ts                   # Groq client (Llama 3.3)
│           └── cache.ts                  # Upstash Redis cache
├── pacifica-liq-worker/
│   ├── index.js                          # Render.com liquidation worker
│   └── package.json
├── .env.example
├── next.config.js
└── tsconfig.json
```

---

## Environment Variables

```env
# Privy (wallet auth)
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_PRIVY_CLIENT_ID=

# Pacifica
NEXT_PUBLIC_PACIFICA_API=https://api.pacifica.fi/api/v1
NEXT_PUBLIC_PACIFICA_WS=wss://ws.pacifica.fi/ws

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# AI
GROQ_API_KEY=
ELFA_API_KEY=

# Response cache (optional — Upstash Redis)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

**Render Worker:**
```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
RENDER_EXTERNAL_URL=https://your-worker.onrender.com
PORT=10000
```

---

## Supabase Setup

```sql
-- Liquidations table (24h rolling window)
create table if not exists liquidations (
  id         bigserial primary key,
  trade_id   text unique not null,
  symbol     text not null,
  side       text not null,
  price      numeric not null,
  amount     numeric not null,
  notional   numeric not null,
  cause      text not null,
  ts         timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists idx_liq_ts     on liquidations (ts desc);
create index if not exists idx_liq_symbol on liquidations (symbol, ts desc);

alter table liquidations enable row level security;
create policy "allow_select" on liquidations for select using (true);
create policy "allow_insert" on liquidations for insert with check (true);
create policy "allow_delete" on liquidations for delete using (true);

-- Globe pins
create table if not exists pins (
  id         bigserial primary key,
  label      text not null,
  lat        numeric not null,
  lng        numeric not null,
  created_at timestamptz default now()
);

alter table pins enable row level security;
create policy "allow_select" on pins for select using (true);
create policy "allow_insert" on pins for insert with check (true);
```

---

## Local Development

```bash
git clone https://github.com/sinirlibiber/PacificaLens.git
cd PacificaLens

npm install

cp .env.example .env.local
# Fill in your environment variables

npm run dev
# → http://localhost:3000
```

---

## Liquidation Worker (Render.com)

The worker in `pacifica-liq-worker/` is a standalone Node.js service:

```bash
cd pacifica-liq-worker
npm install
node index.js
```

**Deploy to Render.com:**
1. Connect your GitHub repo
2. Root Directory: `pacifica-liq-worker`
3. Build Command: `npm install`
4. Start Command: `node index.js`
5. Instance Type: Free
6. Add environment variables

The worker:
- Connects to Pacifica WebSocket on startup and stays connected 24/7
- Subscribes to all 63 markets
- Detects `market_liquidation` and `backstop_liquidation` events
- Batches and upserts to Supabase every 5 seconds (deduplication via `trade_id`)
- Deletes rows older than 24h every hour
- Self-pings every 10 minutes to prevent Render free-tier sleep

---

## Supported Wallets

| Wallet | Type |
|--------|------|
| Phantom | Browser extension |
| Solflare | Browser extension |
| Backpack | Browser extension |
| OKX Wallet | Browser extension |
| All Solana wallets | WalletConnect |

---

## Builder Code Integration

PacificaLens uses Pacifica's Builder Code system for all order submission. Users sign a one-time approval transaction before their first order. This enables builder attribution, fee rebate eligibility, and seamless order flow without leaving the platform. The signing flow supports all wallet types (Privy embedded, Phantom, Solflare, Backpack) with automatic provider fallback.

---

## License

MIT © PacificaLens — Built for the Pacifica Hackathon 2026
