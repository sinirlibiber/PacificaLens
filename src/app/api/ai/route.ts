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
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return '';
    const json = await res.json();

    const tickers: Record<string, unknown>[] =
      json.success && Array.isArray(json.data) ? json.data :
      Array.isArray(json) ? json : [];

    // Key coins to include in context
    const TARGETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK'];

    const lines = tickers
      .filter((t: Record<string, unknown>) => TARGETS.includes(String(t.symbol ?? '').replace('-PERP', '').replace('USDT', '').replace('USD', '')))
      .slice(0, 10)
      .map((t: Record<string, unknown>) => {
        const symbol = String(t.symbol ?? '').replace('-PERP', '');
        const price = Number(t.mark || t.oracle || t.last || 0);
        const change = Number(t.change_24h ?? t.price_change_pct_24h ?? 0);
        if (!price) return null;
        const changeStr = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
        return `${symbol}: $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })} (24h: ${changeStr})`;
      })
      .filter(Boolean);

    if (!lines.length) return '';
    return `\n\nLIVE MARKET PRICES (as of now — use these, not your training data):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question: string = (body?.question ?? '').trim();

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

    // Fetch live prices in parallel with query routing setup
    const priceContext = await getLivePriceContext();
    const result = await routeQuery(question, priceContext);
    return NextResponse.json(result);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AI Route Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
