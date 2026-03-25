import { NextResponse } from 'next/server';

// ForexFactory public JSON — proxied through allorigins to avoid CORS
const SOURCES = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
];

// Multiple CORS proxies to try in order
const PROXIES = [
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

async function fetchWithProxy(src: string): Promise<object[]> {
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(src), {
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const wrapper = await res.json();
      // allorigins wraps in { contents }, corsproxy returns raw
      const raw = wrapper.contents ?? wrapper;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const events = JSON.parse(text);
      if (Array.isArray(events) && events.length > 0) return events;
    } catch { continue; }
  }
  return [];
}

export async function GET() {
  const allEvents: object[] = [];

  for (const src of SOURCES) {
    const events = await fetchWithProxy(src);
    allEvents.push(...events);
  }

  if (allEvents.length > 0) {
    return NextResponse.json(allEvents);
  }

  // All sources failed — return empty array with a flag so the UI can show
  // "Calendar unavailable" instead of displaying stale/fake data
  return NextResponse.json([], {
    headers: { 'X-Calendar-Source': 'unavailable' },
  });
}
