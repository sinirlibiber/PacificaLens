import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // CryptoPanic public feed — no API key needed
    const res = await fetch(
      'https://cryptopanic.com/api/free/v1/posts/?auth_token=&public=true&currencies=BTC,ETH,SOL&kind=news',
      { next: { revalidate: 120 } }
    );
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    // Fallback: Coindesk RSS via allorigins
    const rssUrl = 'https://www.coindesk.com/arc/outboundfeeds/rss/';
    const proxyRes = await fetch(
      `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`,
      { cache: 'no-store' }
    );
    if (!proxyRes.ok) throw new Error('All sources failed');
    const xml = (await proxyRes.json()).contents as string;
    const items: {
      title: string; link: string; source: string;
      pubDate: string; urlToImage?: string; category?: string;
    }[] = [];
    // Use exec loop instead of matchAll (ES5 compatible)
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) !== null && items.length < 25) {
      const block = m[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
      const img = (block.match(/<media:content[^>]*url="([^"]+)"/) || block.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1] || '';
      const cat = (block.match(/<category>(.*?)<\/category>/) || [])[1] || 'Crypto';
      if (title) items.push({ title, link, source: 'CoinDesk', pubDate, urlToImage: img, category: cat });
    }
    return NextResponse.json({ results: items });
  } catch (e) {
    return NextResponse.json({ error: String(e), results: [] }, { status: 200 });
  }
}
