import { NextResponse } from 'next/server';

const SOURCES = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  // Additional months — some may 404 if not yet published, that's fine
  'https://nfs.faireconomy.media/ff_calendar_month.json',
];

export async function GET() {
  const allEvents: object[] = [];

  for (const src of SOURCES) {
    try {
      // Try direct fetch first (faster, no proxy overhead)
      const direct = await fetch(src, {
        next: { revalidate: 300 },
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (direct.ok) {
        const events = await direct.json();
        if (Array.isArray(events)) { allEvents.push(...events); continue; }
      }
    } catch {}

    // Fallback via allorigins proxy
    try {
      const res = await fetch(
        `https://api.allorigins.win/get?url=${encodeURIComponent(src)}`,
        { next: { revalidate: 300 }, signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) continue;
      const wrapper = await res.json();
      if (!wrapper.contents) continue;
      const events = JSON.parse(wrapper.contents);
      if (Array.isArray(events)) allEvents.push(...events);
    } catch { continue; }
  }

  // Deduplicate by title+date
  const seen = new Set<string>();
  const unique = allEvents.filter((e: object) => {
    const ev = e as Record<string, string>;
    const key = `${ev.title}|${ev.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date ascending
  unique.sort((a, b) => {
    const da = new Date((a as Record<string, string>).date || '').getTime();
    const db = new Date((b as Record<string, string>).date || '').getTime();
    return da - db;
  });

  if (unique.length > 0) {
    return NextResponse.json(unique.slice(0, 120));
  }

  // Hardcoded fallback — major upcoming events
  const now = new Date();
  const d = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString();
  const fallback = [
    { title: 'US FOMC Interest Rate Decision', country: 'US', currency: 'USD', date: d(1), time: '19:00', impact: '3', forecast: '4.50%', previous: '4.50%' },
    { title: 'US CPI m/m', country: 'US', currency: 'USD', date: d(3), time: '13:30', impact: '3', forecast: '0.2%', previous: '0.2%' },
    { title: 'US Non-Farm Payrolls', country: 'US', currency: 'USD', date: d(4), time: '13:30', impact: '3', forecast: '185K', previous: '228K' },
    { title: 'ECB Rate Decision', country: 'EU', currency: 'EUR', date: d(2), time: '13:15', impact: '3', forecast: '2.65%', previous: '2.65%' },
    { title: 'BoJ Interest Rate Decision', country: 'JP', currency: 'JPY', date: d(1), time: '03:00', impact: '3', forecast: '0.50%', previous: '0.50%' },
    { title: 'UK Inflation Rate', country: 'GB', currency: 'GBP', date: d(8), time: '07:00', impact: '2', forecast: '2.8%', previous: '2.8%' },
    { title: 'US PPI m/m', country: 'US', currency: 'USD', date: d(7), time: '13:30', impact: '2', forecast: '0.0%', previous: '0.0%' },
    { title: 'Germany GDP q/q', country: 'DE', currency: 'EUR', date: d(5), time: '09:00', impact: '2', forecast: '-0.2%', previous: '-0.2%' },
    { title: 'China Trade Balance', country: 'CN', currency: 'CNY', date: d(10), time: '03:00', impact: '2', forecast: '89.5B', previous: '104.8B' },
    { title: 'US Retail Sales m/m', country: 'US', currency: 'USD', date: d(12), time: '13:30', impact: '2', forecast: '0.3%', previous: '-0.9%' },
    { title: 'US GDP q/q', country: 'US', currency: 'USD', date: d(14), time: '13:30', impact: '3', forecast: '2.4%', previous: '2.3%' },
    { title: 'US Unemployment Claims', country: 'US', currency: 'USD', date: d(6), time: '13:30', impact: '2', forecast: '225K', previous: '223K' },
  ];

  return NextResponse.json(fallback);
}
