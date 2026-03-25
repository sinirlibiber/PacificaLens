import { NextRequest, NextResponse } from 'next/server';

// Lighter (zklighter) — Starknet-based DEX
// Base URL may change; if this endpoint fails the arbitrage scanner silently skips Lighter.
const LIGHTER_BASE = 'https://mainnet.zklighter.elliot.ai/api/v1';

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') || 'funding-rates';
  try {
    const res = await fetch(`${LIGHTER_BASE}/${path}`, {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      // Return empty structure so arbitrage hook can silently skip
      return NextResponse.json({ funding_rates: [] }, { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // Network error or timeout — return empty so caller can skip gracefully
    return NextResponse.json({ funding_rates: [] }, { status: 200 });
  }
}
