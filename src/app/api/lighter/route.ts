import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path') || 'funding-rates';
    // Lighter API base: https://mainnet.zklighter.elliot.ai/api/v1/
    const res = await fetch(`https://mainnet.zklighter.elliot.ai/api/v1/${path}`, {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
