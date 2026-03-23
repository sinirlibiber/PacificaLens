/**
 * elfa.ts — Elfa AI client
 * Sadece Twitter/sosyal trend sorularında kullanılır.
 * Cache TTL: 15 dakika (900s)
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

/**
 * En çok konuşulan token'ları getirir (trending tokens)
 */
async function getTrendingTokens(): Promise<string> {
  const res = await fetch(`${ELFA_BASE}/trending/tokens?limit=5`, {
    headers: { 'x-elfa-api-key': ELFA_KEY }
  });
  if (!res.ok) throw new Error(`Elfa API error: ${res.status}`);
  const data = await res.json();
  if (!data.data || data.data.length === 0) return 'Trend verisi bulunamadı.';
  
  return data.data.map((t: any) => 
    `- ${t.token}: ${t.current_count} mention (${t.change_percent?.toFixed(1) ?? '?'}% değişim)`
  ).join('\n');
}

/**
 * "Smart money" ile ilgili kaliteli mention'ları getirir
 */
async function getSmartMentions(): Promise<string> {
  const res = await fetch(`${ELFA_BASE}/smart-mentions?limit=5`, {
    headers: { 'x-elfa-api-key': ELFA_KEY }
  });
  if (!res.ok) throw new Error(`Elfa API error: ${res.status}`);
  const data = await res.json();
  if (!data.data || data.data.length === 0) return 'Smart money mention bulunamadı.';
  
  return data.data.map((m: any) => 
    `- ${m.content.substring(0, 120)}… (👍 ${m.likeCount ?? 0}, 🔁 ${m.repostCount ?? 0})`
  ).join('\n');
}

/**
 * Ana fonksiyon: Soruya göre uygun endpoint’i seçer.
 */
export async function queryElfa(userQuestion: string): Promise<ElfaResult> {
  const cacheKey = makeCacheKey('elfa', userQuestion);
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return { answer: cached, source: 'elfa', cached: true };
  }

  let answer = '';
  const lowerQ = userQuestion.toLowerCase();

  try {
    if (lowerQ.includes('trend') || lowerQ.includes('most talked') || lowerQ.includes('en çok konuşulan')) {
      answer = await getTrendingTokens();
    } else if (lowerQ.includes('smart money') || lowerQ.includes('where is smart money')) {
      answer = await getSmartMentions();
    } else {
      // Varsayılan: trending tokens
      answer = await getTrendingTokens();
    }
  } catch (err) {
    console.error('Elfa hatası:', err);
    answer = 'Elfa API’sine erişilemedi. Lütfen daha sonra tekrar deneyin.';
  }

  await cacheSet(cacheKey, answer, CACHE_TTL);
  return { answer, source: 'elfa', cached: false };
}
