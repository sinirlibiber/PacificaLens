/**
 * groq.ts — Groq API client (Llama 3.1 8B Instant, talimatlara en duyarlı)
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

  // 🔥 GEÇİCİ OLARAK CACHE KAPATILDI (test için)
  // const cached = await cacheGet(cacheKey);
  // if (cached) return { answer: cached, source: 'gemini', cached: true };

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant', // Talimatlara çok iyi uyar
      messages: [
        {
          role: 'system',
          content: `Sana verilen kullanıcı mesajında mutlaka şu başlık altında güncel veriler olacaktır:
GÜNCEL VERİLER (SADECE BUNLARI KULLAN):
- Fiyat: xxx USD
- 24s Değişim: xx%
- 24s Hacim: xxx
- Fonlama Oranı: xxx
- Açık Pozisyon: xxx

KURALLAR:
1. SADECE bu verilerde yazan rakamları kullan.
2. Kendi eğitim verilerindeki hiçbir fiyatı veya piyasa bilgisini KULLANMA.
3. Eğer verilerde olmayan bir şey sorulursa, "Bu konuda verim yok" de.
4. Yatırım tavsiyesi verme.
5. Yanıtını kullanıcının yazdığı dilde ver.`,
        },
        {
          role: 'user',
          content: userQuestion,
        },
      ],
      max_tokens: 512,
      temperature: 0.2, // çok düşük, talimatlara sadık kal
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

  // 🔥 CACHE YAZMA DA GEÇİCİ KAPATILDI
  // await cacheSet(cacheKey, answer, CACHE_TTL);

  return { answer, source: 'gemini', cached: false };
}
