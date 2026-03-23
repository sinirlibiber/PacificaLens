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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') || 'all'; // all | crypto | macro

  // Source 1: CryptoPanic — richest variety, many sources
  try {
    const kindParam = filter === 'macro' ? '&kind=news&regions=en' : '&kind=news';
    const res = await fetch(
      `https://cryptopanic.com/api/free/v1/posts/?auth_token=public&public=true${kindParam}`,
      { cache: 'no-store', headers: { 'Accept': 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      const items: {
        title?: string; url?: string;
        source?: { title?: string };
        published_at?: string;
        currencies?: { code: string }[];
        kind?: string;
      }[] = data?.results ?? [];

      if (items.length > 0) {
        const results: NewsResult[] = items.slice(0, 50).map(item => ({
          title: item.title || '',
          url: item.url || '#',
          source: item.source?.title || 'CryptoPanic',
          pubDate: item.published_at || '',
          urlToImage: '',
          category: item.currencies && item.currencies.length > 0 ? 'Crypto' : 'Macro',
          currencies: item.currencies,
        }));
        return NextResponse.json({ results });
      }
    }
  } catch {}

  // Source 2: CoinGecko News — free, no key
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/news',
      { cache: 'no-store', headers: { 'Accept': 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data?.data ?? []);
      if (items.length > 0) {
        const results: NewsResult[] = items.slice(0, 40).map((item: {
          title?: string; url?: string; author?: string;
          updated_at?: number; thumb_2x?: string; thumb?: string;
        }) => ({
          title: item.title || '',
          url: item.url || '#',
          source: item.author || 'CoinGecko',
          pubDate: item.updated_at ? new Date(item.updated_at * 1000).toISOString() : '',
          urlToImage: item.thumb_2x || item.thumb || '',
          category: 'Crypto',
        }));
        return NextResponse.json({ results });
      }
    }
  } catch {}

  // Source 3: CryptoCompare — fallback
  try {
    const res = await fetch(
      'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest',
      { cache: 'no-store', headers: { 'Accept': 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.Type === 100 && Array.isArray(data.Data) && data.Data.length > 0) {
        const results: NewsResult[] = data.Data.slice(0, 30).map((item: {
          title: string; url: string;
          source_info?: { name?: string };
          published_on: number; imageurl?: string; categories?: string;
        }) => ({
          title: item.title,
          url: item.url,
          source: item.source_info?.name || 'News',
          pubDate: new Date(item.published_on * 1000).toISOString(),
          urlToImage: item.imageurl || '',
          category: item.categories?.split('|')[0] || 'Crypto',
        }));
        return NextResponse.json({ results });
      }
    }
  } catch {}

  // Source 4: CoinDesk RSS via allorigins
  try {
    const proxyRes = await fetch(
      'https://api.allorigins.win/get?url=' + encodeURIComponent('https://www.coindesk.com/arc/outboundfeeds/rss/'),
      { cache: 'no-store' }
    );
    if (proxyRes.ok) {
      const json = await proxyRes.json();
      const xml = json.contents as string;
      const results: NewsResult[] = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m: RegExpExecArray | null;
      while ((m = itemRe.exec(xml)) !== null && results.length < 20) {
        const block = m[1];
        const title = (
          block.match(/<title><!\[CDATA\[(.*?)\]\]>/) ||
          block.match(/<title>(.*?)<\/title>/) || []
        )[1] || '';
        const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
        const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
        const img = (
          block.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
          block.match(/<media:content[^>]*url="([^"]+)"/) ||
          block.match(/<enclosure[^>]*url="([^"]+)"/) || []
        )[1] || '';
        if (title && link) {
          results.push({ title, url: link, source: 'CoinDesk', pubDate, urlToImage: img, category: 'Crypto' });
        }
      }
      if (results.length > 0) return NextResponse.json({ results });
    }
  } catch {}

  return NextResponse.json({ results: [] });
}
