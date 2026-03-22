import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // ForexFactory public JSON feed — no API key
    const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json?version=1';
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Fetch failed');
    const proxy = await res.json();
    const events = JSON.parse(proxy.contents);
    return NextResponse.json(Array.isArray(events) ? events : []);
  } catch (e) {
    // Return empty array — UI handles gracefully
    return NextResponse.json([]);
  }
}
