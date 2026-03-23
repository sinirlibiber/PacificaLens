import { NextResponse } from 'next/server';

export async function GET() {
  const results: {
    title: string; url: string; source: string;
    pubDate: string; urlToImage?: string; category?: string;
  }[] = [];

  // Source 1: CryptoCompare news — no key needed
  try {
    const res = await fetch(
      'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest',
      { next: { revalidate: 120 } }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.Data)) {
        data.Data.slice(0, 25).forEach((item: {
          title: string; url: string; source_info?: { name?: string };
          published_on: number; imageurl?: string; categories?: string;
        }) => {
          results.push({
            title: item.title,
            url: item.url,
            source: item.source_info?.name || 'CryptoCompare',
            pubDate: new Date(item.published_on * 1000).toISOString(),
            urlToImage: item.imageurl || '',
            category: item.categories || 'Crypto',
          });
        });
        return NextResponse.json({ results });
      }
    }
  } catch {}

  // Source 2: CoinDesk RSS fallback
  try {
    const proxyRes = await fetch(
      'https://api.allorigins.win/get?url=' + encodeURIComponent('https://www.coindesk.com/arc/outboundfeeds/rss/'),
      { cache: 'no-store' }
    );
    if (proxyRes.ok) {
      const xml = (await proxyRes.json()).contents as string;
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m: RegExpExecArray | null;
      while ((m = itemRe.exec(xml)) !== null && results.length < 20) {
        const block = m[1];
        const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>/) ||
                       block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
        const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
        const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
        const img = (block.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
                     block.match(/<media:content[^>]*url="([^"]+)"/) ||
                     block.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1] || '';
        if (title) results.push({ title, url: link, source: 'CoinDesk', pubDate, urlToImage: img, category: 'Crypto' });
      }
    }
  } catch {}

  return NextResponse.json({ results });
}
