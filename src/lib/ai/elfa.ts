/**
 * elfa.ts — Elfa AI client
 * Uses only documented GET endpoints: trending/tokens, smart-mentions.
 * All responses are in English.
 * Cache TTL: 15 minutes.
 *
 * Env var: ELFA_API_KEY
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const ELFA_BASE = 'https://api.elfa.ai/v1';
const ELFA_KEY  = process.env.ELFA_API_KEY!;
const CACHE_TTL = 900; // 15 minutes

export interface ElfaResult {
  answer: string;
  source: 'elfa';
  cached: boolean;
}

async function getTrendingTokens(): Promise<string> {
  const res = await fetch(`${ELFA_BASE}/trending/tokens?limit=5`, {
    headers: { 'x-elfa-api-key': ELFA_KEY }
  });
  if (!res.ok) throw new Error(`Elfa API error: ${res.status}`);
  const data = await res.json();
  if (!data.data || data.data.length === 0) return 'No trending token data available.';
  
  return data.data.map((t: any) => 
    `- ${t.token}: ${t.current_count} mentions (${t.change_percent?.toFixed(1) ?? '?'}% change)`
  ).join('\n');
}

async function getSmartMentions(): Promise<string> {
  const res = await fetch(`${ELFA_BASE}/smart-mentions?limit=5`, {
    headers: { 'x-elfa-api-key': ELFA_KEY }
  });
  if (!res.ok) throw new Error(`Elfa API error: ${res.status}`);
  const data = await res.json();
  if (!data.data || data.data.length === 0) return 'No smart money mentions found.';
  
  return data.data.map((m: any) => 
    `- ${m.content.substring(0, 120)}… (👍 ${m.likeCount ?? 0}, 🔁 ${m.repostCount ?? 0})`
  ).join('\n');
}

export async function queryElfa(userQuestion: string): Promise<ElfaResult> {
  const cacheKey = makeCacheKey('elfa', userQuestion);
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'elfa', cached: true };
  }

  let answer = '';
  const lowerQ = userQuestion.toLowerCase();

  try {
    if (lowerQ.includes('trend') || lowerQ.includes('most talked') || lowerQ.includes('popular')) {
      answer = await getTrendingTokens();
    } else if (lowerQ.includes('smart money') || lowerQ.includes('whale') || lowerQ.includes('influencer')) {
      answer = await getSmartMentions();
    } else {
      answer = await getTrendingTokens();
    }
  } catch (err) {
    console.error('Elfa error:', err);
    answer = 'Elfa API is currently unavailable. Please try again later.';
  }

  await cacheSet(cacheKey, answer, CACHE_TTL);
  return { answer, source: 'elfa', cached: false };
}
