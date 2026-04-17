export const runtime = 'edge';
export const revalidate = 15;

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') || 'fapi/v1/premiumIndex';
  try {
    const res = await fetch(`https://fapi.asterdex.com/${path}`, {
      next: { revalidate: 15 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return NextResponse.json([], { status: 200 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // Aster may be offline — return empty array so arbitrage scanner skips silently
    return NextResponse.json([], { status: 200 });
  }
}
