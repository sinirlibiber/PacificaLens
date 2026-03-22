import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // cryptocurrency.cv - no API key required
    const res = await fetch('https://cryptocurrency.cv/api/news?limit=20', {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error('News fetch failed');
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
