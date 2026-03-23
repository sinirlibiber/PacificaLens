/**
 * groq.ts — Groq API client (Mixtral 8x7B, talimatlara daha duyarlı)
 * 
 * Ücretsiz tier: dakikada 30 istek, günde 14.400 istek.
 * Env var: GROQ_API_KEY
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const GROQ_KEY = process.env.GROQ_API_KEY!;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CACHE_TTL = 1800; // 30 dakika

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
      model: 'mixtral-8x7b-32768',  // Daha iyi talimat takibi
      messages: [
        {
          role: 'system',
          content: `Sen bir kripto piyasası asistanısın. Sana verilen kullanıcı mesajında mutlaka güncel fiyat, hacim ve diğer veriler bulunacaktır. Kendi eğitim verilerindeki fiyatları veya piyasa koşullarını ASLA KULLANMA. Sadece mesajda yazılı olan verilere dayanarak yanıt ver. Yatırım tavsiyesi verme. Yanıtını kullanıcının yazdığı dilde ver.`,
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
