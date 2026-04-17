export const runtime = 'edge';
export const revalidate = 15;

import { NextRequest, NextResponse } from 'next/server';
export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path') || 'v4/perpetualMarkets';
    const res = await fetch(`https://indexer.dydx.trade/${path}`, { next: { revalidate: 15 } });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
