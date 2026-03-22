import { NextRequest, NextResponse } from 'next/server';
export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path') || 'fapi/v1/premiumIndex';
    const res = await fetch(`https://fapi.asterdex.com/${path}`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
