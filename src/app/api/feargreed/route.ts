import { NextResponse } from 'next/server';

export async function GET() {
  const CMC_KEY = process.env.CMC_API_KEY;

  // Try CMC first if API key is set
  if (CMC_KEY) {
    try {
      const res = await fetch(
        'https://pro-api.coinmarketcap.com/v3/fear-and-greed/historical?limit=1',
        {
          cache: 'no-store',
          headers: {
            'X-CMC_PRO_API_KEY': CMC_KEY,
            'Accept': 'application/json',
          },
        }
      );
      if (res.ok) {
        const json = await res.json();
        if (json.data?.[0]) {
          return NextResponse.json({
            value: Number(json.data[0].value),
            classification: json.data[0].value_classification,
            source: 'cmc',
          });
        }
      }
    } catch {}
  }

  // Fallback: alternative.me (no key needed)
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data?.[0]) {
        return NextResponse.json({
          value: Number(json.data[0].value),
          classification: json.data[0].value_classification,
          source: 'alternative.me',
        });
      }
    }
  } catch {}

  return NextResponse.json({ error: 'Failed to fetch Fear & Greed data' }, { status: 500 });
}
