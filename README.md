# Pacifica Risk Manager

Smart position sizing and portfolio risk management for [Pacifica DEX](https://app.pacifica.fi).

## Features

- **63 live markets** from Pacifica API with real-time prices via WebSocket
- **Position calculator** — exact lot size, required margin, liquidation price, TP suggestions
- **Portfolio risk meter** — total risk across all open positions
- **Open positions table** — live PnL, entry, mark price, liquidation
- **Privy wallet auth** — Phantom, Solflare, Backpack, email wallets
- **Direct execute** — opens Pacifica with pre-filled trade params

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_PRIVY_APP_ID=cmmtkx6xd028e0clai9kvzw7u
NEXT_PUBLIC_PRIVY_CLIENT_ID=client-WY6Ww9BQmrXbm3jRUWrRTUFVwDMzm3zUaznmp98Rdsioy
NEXT_PUBLIC_PACIFICA_API=https://api.pacifica.fi/api/v1
NEXT_PUBLIC_PACIFICA_WS=wss://ws.pacifica.fi/ws
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables in Vercel dashboard or:
vercel env add NEXT_PUBLIC_PRIVY_APP_ID
vercel env add NEXT_PUBLIC_PRIVY_CLIENT_ID
```

Or connect your GitHub repo to Vercel and it deploys automatically on every push.

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Privy** — wallet authentication (Phantom, Solflare, Backpack)
- **Pacifica REST API + WebSocket** — real-time market data
- **Recharts** — charts (ready to use)

## Project Structure

```
src/
  app/
    layout.tsx      # Root layout with Privy provider
    page.tsx        # Main dashboard
    globals.css     # Global styles + CSS variables
  components/
    Header.tsx          # Top nav + wallet connect
    MarketList.tsx      # Left panel — 63 markets
    Calculator.tsx      # Position sizing form
    Results.tsx         # Calculation output + execute
    StatsBar.tsx        # Account stats top bar
    PositionsTable.tsx  # Open positions
    ConnectScreen.tsx   # Landing / wallet connect
    CoinLogo.tsx        # Coin logo with fallback
    Toast.tsx           # Notification
  hooks/
    useMarkets.ts   # Real-time market data
    useAccount.ts   # Account info + positions
  lib/
    pacifica.ts     # Pacifica API client
    utils.ts        # Format helpers
```

## Roadmap (Hackathon extensions)

- [ ] Builder Code integration for direct order execution
- [ ] Telegram alert bot for risk threshold breaches
- [ ] Trade journal — log every position with notes
- [ ] Multi-position risk calculator
- [ ] PnL share card generator
