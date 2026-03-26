import { NextResponse } from 'next/server';

// Lighter (zklighter) API requires authentication (API key + auth token) for funding-rate endpoints.
// Public endpoints only expose orderbook data, not funding rates.
// Without auth, arbitrage scanning against Lighter is not possible.
// This route returns an empty response so the arbitrage scanner silently skips Lighter.

export async function GET() {
  return NextResponse.json({ funding_rates: [] }, { status: 200 });
}
