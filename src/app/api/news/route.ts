import { NextResponse } from 'next/server';

interface NewsResult {
  title: string;
  url: string;
  source: string;
  pubDate: string;
  urlToImage: string;
  category: string;
  currencies?: { code: string }[];
}

function parseRSS(xml: string, sourceName: string, category = 'Crypto'): NewsResult[] {
  const results: NewsResult[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && results.length < 25) {
    const block = m[1];
    const title = (
      block.match(/<title><!\[CDATA\[(.*?)\]\]>/) ||
      block.match(/<title>(.*?)<\/title>/) || []
    )[1]?.trim() || '';
    const link = (
      block.match(/<link><!\[CDATA\[(.*?)\]\]>/) ||
      block.match(/<link>(.*?)<\/link>/) ||
      block.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/) || []
    )[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1]?.trim() || '';
    const img = (
      block.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
      block.match(/<media:content[^>]*url="([^"]+)"/) ||
      block.match(/<enclosure[^>]*url="([^"]+)"/) ||
      block.match(/<image:url>(.*?)<\/image:url>/) || []
    )[1]?.trim() || '';
    if (title && link) {
      results.push({ title, url: link, source: sourceName, pubDate, urlToImage: img, category });
    }
  }
  return results;
}

async function fetchRSS(url: string, sourceName: string, category = 'Crypto'): Promise<NewsResult[]> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return parseRSS(xml, sourceName, category);
}

export async function GET() {
  // Fetch multiple RSS feeds in parallel — all free, no keys needed
  const feeds = await Promise.allSettled([
    fetchRSS('https://cointelegraph.com/rss', 'CoinTelegraph', 'Crypto'),
    fetchRSS('https://coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk', 'Crypto'),
    fetchRSS('https://decrypt.co/feed', 'Decrypt', 'Crypto'),
    fetchRSS('https://bitcoinmagazine.com/.rss/full/', 'Bitcoin Magazine', 'Crypto'),
    fetchRSS('https://thedefiant.io/feed', 'The Defiant', 'Crypto'),
  ]);

  const all: NewsResult[] = [];
  for (const r of feeds) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Sort by date descending
  all.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  if (all.length > 0) {
    return NextResponse.json({ results: all.slice(0, 60) });
  }

  // Last resort fallback: allorigins proxy for CoinTelegraph
  try {
    const proxyRes = await fetch(
      'https://api.allorigins.win/get?url=' + encodeURIComponent('https://cointelegraph.com/rss'),
      { cache: 'no-store', signal: AbortSignal.timeout(6000) }
    );
    if (proxyRes.ok) {
      const json = await proxyRes.json();
      const results = parseRSS(json.contents as string, 'CoinTelegraph', 'Crypto');
      if (results.length > 0) return NextResponse.json({ results });
    }
  } catch {}

  return NextResponse.json({ results: [] });
}
