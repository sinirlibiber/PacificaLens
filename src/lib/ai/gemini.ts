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
const CACHE_TTL = 300; // 5 dakika

export interface GeminiResult {
  answer: string;
  source: 'gemini';
  cached: boolean;
}

export async function queryGemini(userQuestion: string): Promise<GeminiResult> {
  const cacheKey = makeCacheKey('groq', userQuestion);

  // 1. Cache'de var mı?
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'gemini', cached: true };
  }

  // 2. Groq'a sor
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a crypto trading assistant. Help with market analysis, DeFi concepts, portfolio advice, and general crypto questions. Be concise, practical, and clear. IMPORTANT: Always respond in the exact same language the user writes in. If the user writes in English, respond in English. If the user writes in Turkish, respond in Turkish. Never switch languages.',
        },
        {
          role: 'user',
          content: userQuestion,
        },
      ],
      max_tokens: 512,
      temperature: 0.7,
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

  return { answer, source: 'gemini', cached: false };
}
