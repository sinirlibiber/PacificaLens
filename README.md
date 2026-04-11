<div align="center">

<img src="public/logo.png" alt="PacificaLens Logo" width="90" />

# PACIFICALENS

**The all-in-one analytics & trading intelligence platform for [Pacifica.fi](https://app.pacifica.fi)**

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
- **Continue as Guest** — access all market data without a wallet. Trade execution, AI Assistant, and personal account data require connection.
- 5-slide onboarding modal on first visit — explains each feature, shown once per browser

---

### 📊 Market Overview

Real-time intelligence for all **63 Pacifica perpetual markets** — including HIP-3 external assets (SP500, Gold, Oil, equities, forex).

**Market Table:**
- Live prices, 24h % change, funding rate, volume, open interest — updating every 30s
- Color-coded funding rates: positive = shorts paid, negative = longs paid
- Sparkline mini-charts (4h candles, 4-day window) per row
- Sortable and filterable by any column
- Favorites / Gainers / Losers quick tabs
- Click any row to open the **Market Detail Panel**

**Market Detail Panel:**
- Full bid/ask orderbook with depth visualization
- Recent trades feed (buy/sell with price, size, time)
- Interactive price chart (1m → 1d intervals)
- One-click trade execution directly from the panel

**Top Stats Bar:**
- Fear & Greed Index
- Altcoin Season Index
- Top 3 gainers and losers

---

### ⚖️ Risk Manager

A professional position sizing calculator built for disciplined perpetuals trading. Calculator is available to guests; live position data requires wallet.

**Inputs:**
- Account size (auto-fills from wallet equity)
- Risk % per trade (slider with real-dollar equivalent)
- Entry price (auto-fills from mark price)
- Stop loss (quick buttons: −1% / −2% / −3% / −5%)
- Take profit (R:R ratio or manual price)
- Leverage (slider, 1× → market max)
- Long / Short toggle

**Outputs:**
- Exact position size in contracts and USD
- Required margin
- Estimated liquidation price
- Max loss in USD and %
- TP levels at 1:1, 1:2, 1:3 R:R
- Expected Value calculation
- Daily and weekly funding cost estimate
- Visual price level diagram (Liq → SL → Entry → TP)

**Portfolio Risk Tab (wallet required):**
- Aggregates all open positions
- Total margin used, combined risk %, unrealized PnL
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
- Pacifica vs external DEXes (dYdX, Aster, others)
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

### 🏆 AlphaBoard & Copy Trading

**AlphaBoard (7,800+ tracked traders):**

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

**Trader Detail Drawer (click any row):**
- Full trade history with PnL per trade
- Active positions with entry, mark price, PnL, liquidation price
- Score breakdown bar chart with tooltips
- **Open Trade** button — open the same position manually with your own margin/leverage settings

**Watching Tab:**
Filters to only your starred traders. Enables Auto Copy Trade.

---

### ✋ Open Trade (Manual Copy)

From any trader's position in the AlphaBoard drawer, click **Open Trade** to mirror it manually:

- **Trader Entry** — price they opened at
- **Mark Price** — current market price
- **Price Drift** — % difference between trader entry and now (staleness warning)
- Set your own margin, leverage, stop loss, take profit
- Order type: Market or Limit
- Estimated liquidation price shown in real time
- Executed via connected wallet with PACIFICALENS builder code

---

### 🤖 Auto Copy Trade (Automated Mirroring)

Fully automated position mirroring using Pacifica Agent Keys — no manual intervention required.

**How it works:**
1. Star a trader on AlphaBoard → add to Watching
2. Configure your Pacifica Agent Key in the copy panel
3. PacificaLens scans the trader's positions **every 10 seconds**
4. New position detected → same trade automatically opened on your account
5. Trader closes → your position closes automatically
6. Trader partially reduces → your position reduces proportionally

**Configuration:**
- Copy open / copy close — toggle each independently
- Size mode: fixed USDC per trade OR proportional % of your equity
- Leverage: mirror the trader's leverage OR set a custom fixed multiplier
- Max leverage cap for safety
- Min/max trade size filters

**Order Log:**
Every auto-copy action is logged with status (Success / Failed / Pending), symbol, side, size, price, source trader, and timestamp. Visible in Portfolio → PacificaLens Orders.

---

### 💧 Liquidation Monitor

Real-time and estimated liquidation data across all 63 markets — the most technically unique feature of PacificaLens.

**Three view modes:**
- **⊞ Grid** — card per market with intensity bar, long/short breakdown, color-coded by dominant side
- **☰ List** — compact sortable table with L/S ratio bar
- **⚡ Feed** — chronological event stream of individual liquidation events

**Time ranges:** 1h / 6h / 24h / 7d


### 📉 Liquidation Leverage Map

Click any market in the Liquidation Monitor for a Coinglass-style canvas chart.

- **Upper panel (78%):** Price line chart with mark price dashed overlay
- **Lower panel (22%):** Liq leverage bars split by long (teal) and short (red) at each price level, with gradient fills and cumulative overlay lines
- **Tooltip:** OHLC on upper panel, liq notional + cumulative on lower panel
- **Ranges:** 12h / 24h / 48h / 7d

---

### 🤖 AI Assistant

Intelligent market assistant with a dual-model routing architecture. Requires wallet connection.

**Routing logic:**
- **Elfa AI** → social/sentiment queries (trending tokens, Twitter buzz, whale narratives) — 15-min cache
- **Groq (Llama 3.3 70B)** → everything else (market analysis, DeFi concepts, risk) — 30-min cache

**Live context:** Current Pacifica mark prices are injected into every query — always answers with real market data.

**Example questions:**
- "What's the funding rate on SOL right now?"
- "Which tokens are whales accumulating?"
- "Is 2% risk per trade too much for a $1,000 account?"
- "Analyze BTC technically"

---

### 📊 Analytics & AI

Deep market analytics navigable via a left sidebar.

- AI Assistant (see above)
- **Funding Rates — Most Extreme:** Bar chart of top 10 most extreme rates, color-coded
- **Long/Short Ratio:** Per-market bias bars estimated from funding rate direction
- **OI Distribution:** Donut chart with total OI center label + volume dominance bars
- **All Markets Funding Rate:** Color heatmap of all 63 markets — high-intensity cells show white text for readability
- **Market Signals:** Real-time OI spike (≥2% change) and funding anomaly alerts
- **Liquidation Monitor:** Full liquidation section (see above)
- **Global News:** Aggregated crypto news with All / Crypto / Macro filter
- **Economic Calendar:** ForexFactory events for current + next week

---

### 💼 Portfolio

Full account management for the connected wallet.

**Summary cards:** Account Equity · Available Balance · Unrealized PnL · Margin Used

**PnL History Chart:** Cumulative realized PnL built from trade history — sorted chronologically, zero baseline shown, colors by profitability. Labeled "Estimated · realized trades only".

**Tabs:**
- **Positions** — live open positions with mark price, unrealized PnL, ROI%, liquidation price, close button
- **Open Orders** — active limit orders with cancel button
- **Trade History** — full execution history with realized PnL per trade
- **Funding History** — all funding payments with rate and timestamp
- **PacificaLens Orders** — full auto-copy order log with status, source trader, timestamp
- **Copy Performance** — copy trading win rate, total P&L, best/worst trade
- **Price Alerts** — manage all active alerts
- **Journal** — personal trade journal (symbol, side, notes, result, PnL) stored locally
- **Performance** — win rate, profit factor, average win/loss, daily/weekly PnL charts

---

### 🔔 Price Alerts

- Set trigger above/below for any of the 63 markets
- Browser push notification support
- Persist in localStorage across sessions
- Enable/disable without deleting

---

## Pacifica.fi API Integration

All calls proxied through `/api/proxy` → `https://api.pacifica.fi/api/v1/`

### Public Endpoints

| Endpoint | Used For |
|----------|----------|
| `GET /info` | All 63 markets — tick size, leverage, funding rates, isolated margin |
| `GET /info/prices` | Live tickers — mark price, OI, funding, 24h volume |
| `GET /leaderboard?limit=25000` | Full trader list for AlphaBoard |
| `GET /orderbook?symbol=BTC-USD` | Live bid/ask levels with depth |
| `GET /kline?symbol=BTC-USD&interval=1h` | OHLCV candlestick data |
| `GET /trades?symbol=BTC-USD&limit=500` | Recent trades + liquidation events via `cause` field |

### Authenticated Endpoints

| Endpoint | Used For |
|----------|----------|
| `GET /account?account=WALLET` | Equity, balance, margin, fee tiers |
| `GET /positions?account=WALLET` | Open positions with PnL, liq price, leverage |
| `GET /trades/history?account=WALLET` | Trade history for PnL chart |
| `GET /funding/history?account=WALLET` | Funding payments |
| `GET /leaderboard/positions?account=WALLET` | A trader's positions for copy trading |
| `POST /order` | Place market/limit orders |

### Order Signing (Ed25519)

Follows [Pacifica's signing spec](https://pacifica.gitbook.io/docs/api-documentation/api/signing/implementation):

1. Build payload with `builder_code: "PACIFICALENS"`
2. Sort all JSON keys alphabetically
3. SHA-256 hash → Ed25519 sign via Privy wallet or Agent Key
4. POST with `timestamp` + `signature`

Builder fee: **0.1%** — tagged to PACIFICALENS automatically on every order.

### Agent Key System

Agent Keys are delegated signing keys that allow PacificaLens to trade on behalf of users without manual wallet approval per trade:

- User generates an Agent Key pair on Pacifica.fi → Account Settings
- Private key stored in browser localStorage only — never sent to any server
- PacificaLens signs orders using TweetNaCl Ed25519 with the agent key
- Main wallet approves the relationship once — all subsequent auto-copy trades are instant

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
| Charts | Recharts, Canvas 2D (custom), Three.js (globe) |
| AI Social | Elfa AI v2 |
| AI General | Groq API (Llama 3.3 70B Versatile) |
| Database | Supabase |
| Worker | Node.js on Render.com |
| Deployment | Vercel |

---

## Project Structure

```
PacificaLens/
├── src/
│   ├── app/
│   │   ├── page.tsx                      # Landing — globe + wallet connect + guest mode
│   │   ├── overview/page.tsx             # Market overview + onboarding modal
│   │   ├── analytics/page.tsx            # Analytics & AI dashboard
│   │   ├── risk/page.tsx                 # Risk manager (partial guest access)
│   │   ├── arbitrage/page.tsx            # Arbitrage scanner
│   │   ├── arbitrage/bot/page.tsx        # Alert bot config
│   │   ├── smart-money/page.tsx          # AlphaBoard + copy trading
│   │   ├── portfolio/page.tsx            # Portfolio management
│   │   └── api/
│   │       ├── proxy/route.ts            # Pacifica API CORS proxy
│   │       ├── liq-multi/route.ts        # Liquidation aggregator (crypto + HIP-3)
│   │       ├── liq-leverage/route.ts     # Liquidation leverage map levels
│   │       ├── liquidations/recent/      # Recent liq events
│   │       ├── trader-score/route.ts     # Batch trader scoring (force-dynamic)
│   │       ├── ai/route.ts               # Groq/Elfa router with live price context
│   │       ├── order/route.ts            # Order placement proxy
│   │       ├── hyperliquid/route.ts      # External DEX funding proxy
│   │       ├── dydx/route.ts             # dYdX funding proxy
│   │       ├── aster/route.ts            # Aster exchange proxy
│   │       ├── news/route.ts             # Crypto news aggregator
│   │       ├── calendar/route.ts         # Economic calendar proxy
│   │       └── pins/route.ts             # Globe pins (Supabase)
│   ├── components/
│   │   ├── AppShell.tsx                  # Global state, routing, auth context
│   │   ├── Header.tsx                    # Navigation + wallet info
│   │   ├── Overview.tsx                  # Market table + detail panel
│   │   ├── Analytics.tsx                 # All analytics sections + sidebar nav
│   │   ├── HeatmapView.tsx               # Liquidation Monitor (grid/list/feed)
│   │   ├── LiquidationHeatmapModal.tsx   # Liquidation Leverage Map (canvas)
│   │   ├── CopyTrading.tsx               # AlphaBoard + auto copy settings
│   │   ├── TraderModal.tsx               # Trader detail drawer
│   │   ├── ScoreBadge.tsx                # Score badge + breakdown card
│   │   ├── TradingPanel.tsx              # Trade execution (wallet required)
│   │   ├── RiskManager.tsx               # Position calculator + portfolio risk
│   │   ├── Calculator.tsx                # Risk calc form
│   │   ├── Results.tsx                   # Calc output + execute button
│   │   ├── Arbitrage.tsx                 # Arbitrage scanner UI
│   │   ├── ArbitrageScanner.tsx          # Multi-exchange comparison
│   │   ├── WhaleWatcher.tsx              # Whale feed + pressure map
│   │   ├── AiAssistant.tsx               # AI chat (locked for guests)
│   │   ├── Portfolio.tsx                 # Portfolio + tabs
│   │   ├── PriceAlerts.tsx               # Alert management
│   │   ├── OnboardingModal.tsx           # 5-slide first-visit onboarding
│   │   ├── GlobeMap.tsx                  # Three.js interactive globe
│   │   ├── CoinLogo.tsx                  # Coin icon with fallback
│   │   ├── ConnectWalletButton.tsx       # Privy connect + Continue as Guest
│   │   └── Toast.tsx                     # Toast notifications
│   ├── hooks/
│   │   ├── useWhaleWatcher.ts            # Real-time whale WebSocket hook
│   │   ├── useLiquidationHeatmap.ts      # Liq data aggregation hook
│   │   ├── useCopyTrading.ts             # AlphaBoard + copy state
│   │   ├── usePositionMirror.ts          # Auto-copy mirroring engine (10s poll)
│   │   ├── useArbitrage.ts               # Multi-exchange funding fetcher
│   │   ├── useAccount.ts                 # Account info + positions
│   │   ├── useMarkets.ts                 # Market list cache
│   │   ├── usePriceAlerts.ts             # Alert state + notifications
│   │   ├── useOrderLog.ts                # Order history logger
│   │   └── useTheme.ts                   # Dark/light theme toggle
│   └── lib/
│       ├── pacifica.ts                   # Pacifica REST API client
│       ├── pacificaSigning.ts            # Ed25519 signing + Builder Code
│       ├── traderScore.ts                # Trader scoring algorithm v3
│       ├── utils.ts                      # Formatters (price, PnL, time)
│       └── ai/
│           ├── router.ts                 # Groq/Elfa routing logic
│           ├── elfa.ts                   # Elfa AI client
│           ├── groq.ts                   # Groq client (Llama 3.3)
│           └── cache.ts                  # Response cache
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

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# AI
GROQ_API_KEY=
ELFA_API_KEY=
```

---


## Supported Wallets

| Wallet | Type |
|--------|------|
| Phantom | Browser extension |
| Solflare | Browser extension |
| Backpack | Browser extension |
| Privy embedded | In-app (no extension needed) |

---

## Security Notes

- Agent Key private keys stored in browser localStorage only — never transmitted to any server
- Order signing happens client-side using TweetNaCl Ed25519
- All Pacifica API calls proxied server-side via `/api/proxy` to avoid CORS and hide direct API patterns
- Builder admin functions require a specific wallet address (BUILDER_WALLET constant)
- Guest mode exposes only public market data — no wallet or account data accessible without connection

---

## Builder Code Integration

PacificaLens uses Pacifica's Builder Code system (`PACIFICALENS`) for all order submission. Users sign a one-time approval transaction before their first order. This enables builder attribution and fee rebate eligibility. The signing flow supports all wallet types (Privy embedded, Phantom, Solflare, Backpack) with automatic provider fallback.

---

<div align="center">

MIT © PacificaLens — Built for the Pacifica Hackathon 2026

[pacificalens.xyz](https://pacificalens.xyz)

</div>
