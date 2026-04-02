import { NextResponse } from 'next/server';

// ForexFactory JSON — server-side fetch, no CORS issue
const FF_SOURCES = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
];

async function fetchFF(url: string): Promise<object[]> {
  try {
    const res = await fetch(url, {
      headers: {
        // Some hosts block default fetch UA — spoof a browser
        'User-Agent': 'Mozilla/5.0 (compatible; PacificaLens/1.0)',
        'Accept': 'application/json, */*',
      },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Fallback: fetch via allorigins proxy (when direct is blocked)
async function fetchViaProxy(url: string): Promise<object[]> {
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const wrapper = await res.json();
    const text = typeof wrapper.contents === 'string' ? wrapper.contents : JSON.stringify(wrapper.contents ?? []);
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const allEvents: object[] = [];

  for (const url of FF_SOURCES) {
    // Try direct first (no proxy overhead), then fall back to proxy
    let events = await fetchFF(url);
    if (!events.length) {
      events = await fetchViaProxy(url);
    }
    allEvents.push(...events);
  }

  if (allEvents.length > 0) {
    return NextResponse.json(allEvents);
  }

  return NextResponse.json([], {
    headers: { 'X-Calendar-Source': 'unavailable' },
  });
}
