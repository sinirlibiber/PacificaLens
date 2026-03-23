/**
 * POST /api/ai
 * Body: { question: string }
 * Response: { answer: string; source: 'elfa' | 'gemini'; cached: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { routeQuery } from '@/lib/ai/router';

export const maxDuration = 30;

// Fetch live prices from Pacifica (server-side, no CORS issue)
async function getLivePriceContext(): Promise<string> {
  try {
    const res = await fetch('https://api.pacifica.fi/api/v1/info/prices', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return '';
    const json = await res.json();

    const raw: Record<string, unknown>[] =
      json.success && Array.isArray(json.data) ? json.data :
      Array.isArray(json) ? json : [];

    const TARGETS = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK', 'OP', 'ARB']);
    const lines: string[] = [];

    for (const t of raw) {
      const rawSym = String(t.symbol ?? '');
      const sym = rawSym.replace(/-PERP$/i, '').replace(/USDT$/i, '').replace(/USD$/i, '').toUpperCase();
      if (!TARGETS.has(sym)) continue;
      const price = Number(t.mark ?? t.oracle ?? t.mid ?? 0);
      if (!price) continue;
      lines.push(`${sym}: $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    }

    if (!lines.length) return '';
    return `\n\nLIVE MARKET PRICES RIGHT NOW — use ONLY these, never your training data for prices:\n${lines.join('\n')}`;
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
