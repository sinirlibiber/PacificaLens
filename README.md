<div align="center">
  <img src="public/logo.png" alt="PacificaLens Logo" width="80" />

  <h1>PacificaLens</h1>

  <p><strong>The all-in-one analytics & trading assistant for <a href="https://app.pacifica.fi">Pacifica.fi</a></strong></p>

  <p>
    <a href="https://www.pacificalens.xyz">🌐 Live Demo</a> ·
    <a href="https://app.pacifica.fi">Pacifica DEX</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" />
    <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" />
    <img src="https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss" />
    <img src="https://img.shields.io/badge/Solana-Privy-9945FF?logo=solana" />
    <img src="https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel" />
  </p>
</div>

---

## What is PacificaLens?

PacificaLens is a feature-rich, real-time trading analytics and assistant platform built on top of [Pacifica DEX](https://app.pacifica.fi) — a decentralized perpetuals exchange on Solana. It extends the Pacifica trading experience with an intelligent dashboard that combines whale tracking, funding-rate arbitrage scanning, copy trading, AI-powered insights, portfolio analytics, risk management, and more — all in one place.

The live app is available at **[https://www.pacificalens.xyz](https://www.pacificalens.xyz)**.

---

## Features

### 🌍 Globe Landing Page
An immersive Three.js 3D globe serves as the entry point. Users connect their Solana wallet directly from the landing page using Privy, which supports Phantom, Solflare, Backpack, and email-based embedded wallets.

---

### 📊 Market Overview
- **63 live markets** from the Pacifica REST API with real-time prices via WebSocket
- Sortable market table by: price, 24h change, volume, open interest, funding rate
- **Sparkline charts** (4-hour candles, 4-day window) for every market
- **Fear & Greed Index** fetched from external data source
- Heat-colored funding rate cells — instantly see which markets are overheated
- Market search and filtering

---

### ⚖️ Risk Manager
A precision position sizing calculator designed for disciplined traders:
- Input account size, risk percentage, leverage, and entry/stop-loss prices
- Calculates exact **lot size**, **required margin**, **liquidation price**, **max loss**, and **TP suggestions** (1:1, 1:2, 1:3 RR ratios)
- Real-time mark price auto-fills from WebSocket feed
- **Portfolio risk meter** — aggregates total risk exposure across all open positions
- **Open positions table** with live PnL, entry price, mark price, and liquidation distance
- **Direct execute** — opens Pacifica DEX with pre-filled trade parameters via Builder Code integration

---

### 🔄 Funding Rate Arbitrage Scanner
Find and exploit funding rate differentials across exchanges:
- Cross-exchange funding rate comparison: **Pacifica vs Hyperliquid** and **Pacifica vs dYdX**
- Real-time spread calculation shown as 8-hour rate and **annualized APR**
- Filter by minimum APR threshold (default: 3%)
- Filter by exchange pair (HL, dYdX, or all)
- Opportunities sorted and tiered as `high`, `medium`, or `low`
- **Automated arbitrage bot** — configurable position sizing and auto-execution interval

---

### 🐋 Whale Watcher
Monitor large trades and liquidations across Pacifica in real time:
- Scans all markets every 5 seconds for whale-sized trades
- Displays **whale trade feed** with: symbol, side (long/short open/close), notional size, price, and whether it was a liquidation
- **Symbol pressure map** — aggregated bull/bear score, long/short notional, liquidation count, OI change, and funding spike indicator per symbol
- Filter whale trades by side (long/short), minimum flow size
- Sort pressure map by: total whale flow, bull score, trade count, liquidations
- **Wallet lookup** — enter any address to see their recent Pacifica trades
- Detailed trade modal and position detail modal with trade history

---

### 👥 Smart Money / Copy Trading
Follow and mirror the top traders on Pacifica:
- **Leaderboard** with 7d/30d/all-time PnL, volume, current equity, and open interest
- Proprietary **Trader Score** system (0–100, tiers S/A/B/C/D) calculated from:
  - PnL performance (0–40 pts, highest weight)
  - Consistency: 7d vs 30d PnL ratio (0–25 pts)
  - Activity volume (0–20 pts)
  - Risk-adjusted PnL/volume efficiency (0–15 pts)
- Click any trader to open their **Trader Modal**: full trade history, PnL chart, active positions
- **Auto-copy settings**: configure copy ratio, max position size, allowed symbols, delay, and whether to copy opens/closes
- **Position mirroring** hook — automatically mirrors a watched trader's positions to your own account via Pacifica Builder Code
- Pin favorite traders to the top of your list (persisted via Supabase)
- Sort by any leaderboard column; toggle watching per trader

---

### 💼 Portfolio
Full account analytics for the connected wallet:
- **Account summary**: equity, margin balance, unrealized PnL, available balance
- **Account tabs**: positions, open orders, order history, trade history
- Performance metrics: win rate, average win/loss, profit factor
- Exportable trade history
- PnL charts over time using Recharts

---

### 📈 Analytics
Deep market analytics across all Pacifica markets:
- Funding rate history charts per symbol
- Open interest trends
- Volume analysis
- Market correlation matrix
- Aggregated exchange-wide statistics

---

### 🔔 Price Alerts
Set and manage custom price alerts:
- Alerts for any of the 63 listed markets
- Trigger conditions: price **above** or **below** a target level
- Browser push notification support (with permission request)
- Alerts persist in `localStorage`; triggered alerts are logged with timestamp
- Enable/disable individual alerts without deleting them

---

### 🤖 AI Assistant
An integrated AI chat assistant powered by a dual-model routing architecture:
- **Elfa AI** — handles Twitter/social trend queries, sentiment analysis, whale/smart money narratives, and hot coin lookups (with 15-minute response cache)
- **Gemini** — handles everything else: market analysis, DeFi explanations, trading concepts, real-time price context (with 5-minute cache)
- **Live price injection**: current Pacifica mark prices are injected into every AI query so the assistant always answers with real market data, never stale training data
- Suggested questions panel for quick access to common queries
- Conversation history maintained per session

---

### 📰 News Feed
Aggregated crypto news from multiple RSS sources, parsed and displayed in the dashboard with thumbnails, sources, and publication dates.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| Wallet Auth | Privy (`@privy-io/react-auth`) — Phantom, Solflare, Backpack, email |
| Blockchain | Solana (`@solana/web3.js`, `bs58`, `tweetnacl`) |
| Market Data | Pacifica REST API + WebSocket (`wss://ws.pacifica.fi/ws`) |
| Charts | Recharts, Lightweight Charts |
| Globe | Three.js |
| AI — Social | Elfa AI API |
| AI — General | Google Gemini API |
| Database | Supabase (pinned traders, order log) |
| Deployment | Vercel |

---

## Project Structure

```
PacificaLens/
├── public/
│   ├── logo.png
│   └── pacificalens.ico
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout — Privy provider wrapper
│   │   ├── page.tsx                # Landing page — 3D globe + wallet connect
│   │   ├── overview/page.tsx       # Market overview dashboard
│   │   ├── risk/page.tsx           # Risk manager + position calculator
│   │   ├── arbitrage/page.tsx      # Funding rate arbitrage scanner
│   │   ├── arbitrage/bot/page.tsx  # Automated arbitrage bot
│   │   ├── smart-money/page.tsx    # Copy trading / leaderboard
│   │   ├── portfolio/page.tsx      # Portfolio & account analytics
│   │   ├── analytics/page.tsx      # Deep market analytics
│   │   ├── alerts/page.tsx         # Price alerts manager
│   │   ├── trade/page.tsx          # Trade execution
│   │   ├── copy-trading/page.tsx   # Copy trading interface
│   │   ├── globals.css             # Global styles + CSS variables
│   │   └── api/
│   │       ├── ai/route.ts         # AI query endpoint (Elfa/Gemini router)
│   │       ├── aster/route.ts      # Aster exchange data proxy
│   │       ├── calendar/route.ts   # Crypto events calendar
│   │       ├── dydx/route.ts       # dYdX funding rates proxy
│   │       ├── external/route.ts   # External data proxy
│   │       ├── hyperliquid/route.ts # Hyperliquid funding rates proxy
│   │       ├── lighter/route.ts    # Lighter exchange proxy
│   │       ├── news/route.ts       # RSS news aggregator
│   │       ├── order/route.ts      # Order execution endpoint
│   │       ├── pins/route.ts       # Pinned traders (Supabase)
│   │       ├── proxy/route.ts      # Pacifica API CORS proxy
│   │       └── trader-score/route.ts # Trader score calculation endpoint
│   ├── components/
│   │   ├── AppShell.tsx            # Main authenticated shell — routing & state
│   │   ├── Header.tsx              # Top nav + wallet info + market stats
│   │   ├── Overview.tsx            # Market overview table + sparklines
│   │   ├── RiskManager.tsx         # Position calculator + risk meter
│   │   ├── Arbitrage.tsx           # Funding arbitrage scanner
│   │   ├── ArbitrageScanner.tsx    # Extended multi-exchange arbitrage view
│   │   ├── WhaleWatcher.tsx        # Whale trade feed + pressure map
│   │   ├── CopyTrading.tsx         # Smart money leaderboard + copy settings
│   │   ├── TraderModal.tsx         # Individual trader deep-dive modal
│   │   ├── Portfolio.tsx           # Account portfolio view
│   │   ├── Analytics.tsx           # Market analytics charts
│   │   ├── AiAssistant.tsx         # AI chat assistant
│   │   ├── GlobeMap.tsx            # Three.js interactive globe
│   │   ├── Calculator.tsx          # Position sizing calculator form
│   │   ├── Results.tsx             # Calculator output + execute button
│   │   ├── AccountTabs.tsx         # Positions / orders / history tabs
│   │   ├── TradingPanel.tsx        # Trade execution panel
│   │   ├── PriceAlerts.tsx         # Price alerts UI
│   │   ├── MarketList.tsx          # Sidebar market list
│   │   ├── StatsBar.tsx            # Account stats top bar
│   │   ├── ScoreBadge.tsx          # Trader score S/A/B/C/D badge
│   │   ├── PositionsTable.tsx      # Open positions table
│   │   ├── ConnectScreen.tsx       # Unauthenticated landing / connect prompt
│   │   ├── ConnectWalletButton.tsx # Privy connect button
│   │   ├── CoinLogo.tsx            # Coin icon with fallback
│   │   └── Toast.tsx               # Notification toasts
│   ├── hooks/
│   │   ├── useMarkets.ts           # Real-time market data via WebSocket
│   │   ├── useAccount.ts           # Account info + open positions
│   │   ├── useWhaleWatcher.ts      # Whale trade scanner
│   │   ├── useArbitrage.ts         # Cross-exchange funding rate fetcher
│   │   ├── useCopyTrading.ts       # Leaderboard + trader data
│   │   ├── usePositionMirror.ts    # Auto-copy position mirroring
│   │   ├── usePriceAlerts.ts       # Alert state + browser notifications
│   │   ├── useTraderScore.ts       # Trader score fetcher/calculator
│   │   ├── useOrderLog.ts          # Order history logger (Supabase)
│   │   └── useTheme.ts             # Dark/light theme toggle
│   └── lib/
│       ├── pacifica.ts             # Pacifica REST + WebSocket API client
│       ├── pacificaSigning.ts      # Solana transaction signing + Builder Code
│       ├── traderScore.ts          # Trader scoring algorithm
│       ├── utils.ts                # Formatting helpers (price, PnL, etc.)
│       └── ai/
│           ├── router.ts           # AI query router (Elfa vs Gemini)
│           ├── elfa.ts             # Elfa AI client
│           ├── gemini.ts           # Google Gemini client
│           └── cache.ts            # AI response cache
├── .env.example
├── next.config.js
├── tailwind.config.ts
├── vercel.json
└── tsconfig.json
```

---

## Setup & Installation

### Prerequisites
- Node.js 18+
- A [Privy](https://privy.io) account (for wallet authentication)
- A [Supabase](https://supabase.com) project (for pinned traders & order log)
- Google Gemini API key (for AI assistant)
- Groq API key (for AI assistant)
- Elfa AI API key (for social/Twitter queries)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/PacificaLens.git
cd PacificaLens
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

```env
# Privy — wallet authentication
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
NEXT_PUBLIC_PRIVY_CLIENT_ID=your_privy_client_id

# Pacifica DEX — market data
NEXT_PUBLIC_PACIFICA_API=https://api.pacifica.fi/api/v1
NEXT_PUBLIC_PACIFICA_WS=wss://ws.pacifica.fi/ws

# Supabase — persistent storage (pinned traders, order log)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# AI APIs
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
ELFA_API_KEY=your_elfa_api_key
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Build for production

```bash
npm run build
npm run start
```

---



## Supported Wallets

PacificaLens uses [Privy](https://privy.io) for authentication, which supports:

- **Phantom**
- **Solflare**
- **Backpack**
- **All Solana wallets** via WalletConnect
- **Email wallets** (Privy embedded wallet — no browser extension needed)

---

## Roadmap

- [ ] Telegram alert bot for price & risk threshold breaches
- [ ] Trade journal — log every position with notes and tags
- [ ] Multi-position risk calculator (portfolio-level what-if analysis)
- [ ] PnL share card generator
- [ ] Mobile-optimized responsive layout
- [ ] Additional exchange pairs in arbitrage scanner (Lighter, Aster)
- [ ] Historical arbitrage opportunity log

---

## License

MIT © PacificaLens contributors
