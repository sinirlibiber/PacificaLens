/**
 * elfa.ts — Elfa AI client
 * Sadece Twitter/sosyal trend sorularında kullanılır.
 * Cache TTL: 15 dakika (900s) — aynı soruyu 100 kişi sorsa 1 Elfa isteği gider.
 *
 * Env var: ELFA_API_KEY
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const ELFA_BASE = 'https://api.elfa.ai/v1';
const ELFA_KEY  = process.env.ELFA_API_KEY!;
const CACHE_TTL = 900; // 15 dakika

export interface ElfaResult {
  answer: string;
  source: 'elfa';
  cached: boolean;
}

export async function queryElfa(userQuestion: string): Promise<ElfaResult> {
  const cacheKey = makeCacheKey('elfa', userQuestion);

  // 1. Cache'de var mı?
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'elfa', cached: true };
  }

  // 2. Elfa API'ye sor
  const res = await fetch(`${ELFA_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-elfa-api-key': ELFA_KEY,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            'You are a crypto market intelligence assistant. Focus on Twitter/social sentiment, trending coins, and smart money signals. Be concise and data-driven.',
        },
        { role: 'user', content: userQuestion },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Elfa API error: ${res.status}`);
  }

  const data = await res.json();
  // Elfa response şeması: { message: { content: string } }
  const answer: string =
    data?.message?.content ??
    data?.choices?.[0]?.message?.content ??
    'Elfa yanıt vermedi.';

  // 3. Cache'e yaz
  await cacheSet(cacheKey, answer, CACHE_TTL);

  return { answer, source: 'elfa', cached: false };
}
