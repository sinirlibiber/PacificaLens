/**
 * POST /api/ai
 * Body: { question: string }
 * Response: { answer: string; source: 'elfa' | 'gemini'; cached: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { routeQuery } from '@/lib/ai/router';

export const maxDuration = 30;

// Fetch live prices from Pacifica and format as context string
async function getLivePriceContext(): Promise<string> {
  try {
    const res = await fetch('https://api.pacifica.fi/api/v1/tickers', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return '';
    const json = await res.json();

    const raw = json.success && Array.isArray(json.data) ? json.data :
                Array.isArray(json) ? json :
                json.data && Array.isArray(json.data) ? json.data : [];

    const TARGETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK', 'OP', 'ARB'];

    const lines: string[] = [];
    for (const t of raw as Record<string, unknown>[]) {
      // Symbol can be "BTC-PERP", "BTCUSDT", "BTC" etc.
      const rawSym = String(t.symbol ?? t.market ?? '');
      const sym = rawSym.replace(/-PERP$/, '').replace(/USDT$/, '').replace(/USD$/, '').toUpperCase();
      if (!TARGETS.includes(sym)) continue;

      const price = Number(t.mark ?? t.oracle ?? t.last ?? t.price ?? t.index ?? 0);
      if (!price) continue;

      const change24h = Number(t.change_24h ?? t.price_change_pct ?? t.change_pct_24h ?? 0);
      const changeStr = change24h !== 0
        ? ` (24h: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%)`
        : '';

      lines.push(`${sym}: $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}${changeStr}`);
    }

    if (!lines.length) return '';

    return `\n\nLIVE MARKET PRICES RIGHT NOW (use ONLY these prices, ignore your training data for prices):\n${lines.join('\n')}\nTimestamp: ${new Date().toUTCString()}`;
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question: string = (body?.question ?? '').trim();
    const clientPriceContext: string = (body?.priceContext ?? '').trim();

    if (!question) {
      return NextResponse.json({ error: 'Soru boş olamaz.' }, { status: 400 });
    }

    if (question.length > 500) {
      return NextResponse.json({ error: 'Soru 500 karakterden uzun olamaz.' }, { status: 400 });
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY Vercel ortamında tanımlı değil!' },
        { status: 500 }
      );
    }

    // Use client-provided prices (already have live tickers) or fetch from server as fallback
    const priceContext = clientPriceContext
      ? `\n\nLIVE MARKET PRICES RIGHT NOW (use ONLY these, ignore training data for prices):\n${clientPriceContext}`
      : await getLivePriceContext();
    const result = await routeQuery(question, priceContext);
    return NextResponse.json(result);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AI Route Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
