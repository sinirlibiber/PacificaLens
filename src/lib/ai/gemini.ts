/**
 * groq.ts — Groq API client (Mixtral 8x7B, talimatlara en duyarlı model)
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

  // Cache kontrolü (isteğe bağlı, test için kapatabilirsiniz)
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'gemini', cached: true };
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      // Talimatlara en duyarlı model
      model: 'mixtral-8x7b-32768',
      messages: [
        {
          role: 'system',
          content: `Sen bir kripto piyasası asistanısın.
KURAL 1: Sana verilen kullanıcı mesajında güncel fiyat, hacim, değişim yüzdesi gibi veriler olacaktır.
KURAL 2: Kendi eğitim verilerindeki hiçbir fiyatı veya piyasa bilgisini KULLANMA.
KURAL 3: Sadece mesajda yazılı olan rakamlara ve verilere dayanarak yanıt ver.
KURAL 4: Yatırım tavsiyesi verme, sadece verileri yorumla.
KURAL 5: Yanıtını kullanıcının yazdığı dilde ver.`,
        },
        {
          role: 'user',
          content: userQuestion,
        },
      ],
      max_tokens: 512,
      temperature: 0.3, // Daha az yaratıcılık, daha çok talimat takibi
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

  await cacheSet(cacheKey, answer, CACHE_TTL);

  return { answer, source: 'gemini', cached: false };
}
