/**
 * elfa.ts — Social/trending queries via Groq (Elfa fallback)
 * Elfa API entegrasyonu kırıksa Groq'a fallback yapar.
 * Env var: ELFA_API_KEY (opsiyonel)
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const ELFA_BASE = 'https://api.elfa.ai';
const ELFA_KEY  = process.env.ELFA_API_KEY;
const CACHE_TTL = 900; // 15 dakika

const GROQ_KEY = process.env.GROQ_API_KEY!;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface ElfaResult {
  answer: string;
  source: 'elfa';
  cached: boolean;
}

async function queryElfaDirect(userQuestion: string): Promise<string> {
  // Try Elfa v2 smart mentions endpoint
  const res = await fetch(`${ELFA_BASE}/v2/trending-tokens`, {
    headers: {
      'x-elfa-api-key': ELFA_KEY!,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new Error(`Elfa trending API error: ${res.status}`);
  const data = await res.json();

  // Format trending tokens into a readable answer
  const tokens = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  if (!tokens.length) throw new Error('No trending data');

  const list = tokens.slice(0, 8).map((t: Record<string, unknown>, i: number) => {
    const symbol = String(t.token ?? t.symbol ?? t.name ?? '?');
    const mentions = Number(t.mentions ?? t.count ?? 0);
    return `${i + 1}. $${symbol}${mentions ? ` (${mentions.toLocaleString()} mentions)` : ''}`;
  }).join('\n');

  return `Currently trending on crypto Twitter/social media:\n\n${list}\n\nThese tokens are getting the most social attention right now.`;
}

async function queryGroqForSocial(userQuestion: string): Promise<string> {
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
          content: 'You are a crypto social sentiment analyst. Answer questions about trending coins, Twitter/social media buzz, and market narratives. Be concise. Note: you don\'t have real-time Twitter data, so clearly state that and provide general insights based on your training knowledge. IMPORTANT: Always respond in the exact same language the user writes in.',
        },
        { role: 'user', content: userQuestion },
      ],
      max_tokens: 400,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Groq error: ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? 'No response.';
}

export async function queryElfa(userQuestion: string): Promise<ElfaResult> {
  const cacheKey = makeCacheKey('elfa', userQuestion);

  // 1. Cache hit?
  const cached = await cacheGet(cacheKey);
  if (cached) return { answer: cached, source: 'elfa', cached: true };

  let answer: string;

  // 2. Try Elfa if API key exists, fallback to Groq
  if (ELFA_KEY) {
    try {
      answer = await queryElfaDirect(userQuestion);
    } catch {
      // Elfa failed — silently fallback to Groq
      answer = await queryGroqForSocial(userQuestion);
    }
  } else {
    answer = await queryGroqForSocial(userQuestion);
  }

  await cacheSet(cacheKey, answer, CACHE_TTL);
  return { answer, source: 'elfa', cached: false };
}
