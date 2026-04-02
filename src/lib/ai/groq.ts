/**
 * groq.ts — Groq API client (Llama 3.3 70B)
 * Genel kripto soruları, analiz, hesaplama vb. için kullanılır.
 * Ücretsiz tier: dakikada 30 istek, günde 14.400 istek.
 *
 * Env var: GROQ_API_KEY
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const GROQ_KEY = process.env.GROQ_API_KEY!;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CACHE_TTL = 1800; // 30 dakika

export interface GroqResult {
  answer: string;
  source: 'groq';
  cached: boolean;
}

export async function queryGroq(userQuestion: string, priceContext = ''): Promise<GroqResult> {
  const cacheKey = makeCacheKey('groq', userQuestion);

  // 1. Cache'de var mı?
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'groq', cached: true };
  }

  // 2. Groq'a sor
  const systemPrompt = `You are an elite crypto trading analyst and DeFi expert built into PacificaLens, a perpetuals DEX trading platform on Solana.

Your capabilities:
- Technical analysis: support/resistance, trend structure, liquidation zones, funding rates, open interest
- On-chain analysis: whale accumulation patterns, exchange inflows/outflows, derivatives positioning
- DeFi expertise: perpetuals mechanics, leverage risk, liquidation math, funding rate arbitrage
- Market structure: macro cycle positioning, BTC dominance cycles, altcoin rotation patterns
- Risk management: position sizing, stop placement, risk/reward frameworks for perpetuals trading

When answering:
1. Be SPECIFIC and ACTIONABLE — give concrete levels, percentages, scenarios
2. If asked about price targets, provide realistic ranges with reasoning (support/resistance, historical levels)
3. For risk questions, give exact calculations when possible (e.g., "at 10x leverage, a 10% move against you = liquidation")
4. Reference specific market dynamics (funding rates, OI changes, liquidation clusters) when relevant
5. For "should I trade X" questions: assess the setup quality with specific criteria

CRITICAL: Always use the live prices provided below — NEVER use your training data for current prices. Your training data is outdated and will give wrong prices.
CRITICAL: Always respond in the exact same language the user writes in. Turkish → Turkish. English → English.${priceContext}`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userQuestion },
      ],
      max_tokens: 700,
      temperature: 0.65,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq API ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const answer: string =
    data?.choices?.[0]?.message?.content ?? 'Groq yanıt vermedi.';

  // 3. Cache'e yaz
  await cacheSet(cacheKey, answer, CACHE_TTL);

  return { answer, source: 'groq', cached: false };
}
