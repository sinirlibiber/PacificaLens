/**
 * gemini.ts — Google Gemini 2.0 Flash client
 * Genel kripto soruları, analiz, hesaplama vb. için kullanılır.
 * Ücretsiz tier: dakikada 15 istek, günde ~1500 istek.
 *
 * Env var: GEMINI_API_KEY
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const CACHE_TTL  = 300; // 5 dakika

export interface GeminiResult {
  answer: string;
  source: 'gemini';
  cached: boolean;
}

export async function queryGemini(userQuestion: string): Promise<GeminiResult> {
  const cacheKey = makeCacheKey('gemini', userQuestion);

  // 1. Cache'de var mı?
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'gemini', cached: true };
  }

  // 2. Gemini'ye sor
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{
            text: `You are a crypto trading assistant. Help with market analysis, DeFi concepts, portfolio advice, and general crypto questions. Be concise, practical, and clear. IMPORTANT: Always respond in the exact same language the user writes in. If the user writes in English, respond in English. If the user writes in Turkish, respond in Turkish. Never switch languages.\n\nUser question: ${userQuestion}`,
          }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.7,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const answer: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Gemini yanıt vermedi.';

  // 3. Cache'e yaz
  await cacheSet(cacheKey, answer, CACHE_TTL);

  return { answer, source: 'gemini', cached: false };
}
