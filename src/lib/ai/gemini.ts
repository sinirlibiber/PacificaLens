/**
 * gemini.ts — Google Gemini Flash client
 * Genel kripto soruları, analiz, hesaplama vb. için kullanılır.
 * Ücretsiz tier: dakikada 15 istek, günde ~1000 istek.
 *
 * Env var: GEMINI_API_KEY
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const GEMINI_KEY  = process.env.GEMINI_API_KEY!;
const GEMINI_URL  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
const CACHE_TTL   = 300; // 5 dakika — genel sorular daha sık değişebilir

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
      system_instruction: {
        parts: [{
          text: 'You are a crypto trading assistant. Help with market analysis, DeFi concepts, portfolio advice, and general crypto questions. Be concise, practical, and clear. Always answer in the same language the user writes in.',
        }],
      },
      contents: [{ parts: [{ text: userQuestion }] }],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.7,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const answer: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Gemini yanıt vermedi.';

  // 3. Cache'e yaz
  await cacheSet(cacheKey, answer, CACHE_TTL);

  return { answer, source: 'gemini', cached: false };
}
