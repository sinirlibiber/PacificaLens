/**
 * elfa.ts — Elfa AI client
 * Kullanılan endpoint'ler: trending/tokens, smart-mentions
 * Cache TTL: 15 dakika
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const ELFA_BASE = 'https://api.elfa.ai/v1';
const ELFA_KEY  = process.env.ELFA_API_KEY;
const CACHE_TTL = 900; // 15 dakika

export interface ElfaResult {
  answer: string;
  source: 'elfa';
  cached: boolean;
}

async function getTrendingTokens(): Promise<string> {
  if (!ELFA_KEY) throw new Error('ELFA_API_KEY is not set');
  const url = `${ELFA_BASE}/trending/tokens?limit=5`;
  const res = await fetch(url, {
    headers: { 'x-elfa-api-key': ELFA_KEY }
  });
  if (!res.ok) {
    throw new Error(`Elfa trending API error: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.data || json.data.length === 0) return 'No trending token data available.';
  return json.data.map((t: any) => 
    `- ${t.token}: ${t.current_count} mentions (${t.change_percent?.toFixed(1) ?? '?'}% change)`
  ).join('\n');
}

async function getSmartMentions(): Promise<string> {
  if (!ELFA_KEY) throw new Error('ELFA_API_KEY is not set');
  const url = `${ELFA_BASE}/smart-mentions?limit=5`;
  const res = await fetch(url, {
    headers: { 'x-elfa-api-key': ELFA_KEY }
  });
  if (!res.ok) {
    throw new Error(`Elfa smart-mentions API error: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.data || json.data.length === 0) return 'No smart mentions found.';
  return json.data.map((m: any) => {
    const text = m.content?.substring(0, 120) ?? '';
    return `- ${text}… (👍 ${m.likeCount ?? 0}, 🔁 ${m.repostCount ?? 0})`;
  }).join('\n');
}

export async function queryElfa(userQuestion: string): Promise<ElfaResult> {
  const cacheKey = makeCacheKey('elfa', userQuestion);
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'elfa', cached: true };
  }

  let answer = '';
  const lower = userQuestion.toLowerCase();

  try {
    if (lower.includes('trend') || lower.includes('most talked') || lower.includes('en çok konuşulan')) {
      answer = await getTrendingTokens();
    } else if (lower.includes('smart money') || lower.includes('where is smart money')) {
      answer = await getSmartMentions();
    } else {
      answer = await getTrendingTokens();
    }
  } catch (err) {
    console.error('Elfa error:', err);
    answer = `Elfa API error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }

  await cacheSet(cacheKey, answer, CACHE_TTL);
  return { answer, source: 'elfa', cached: false };
}
