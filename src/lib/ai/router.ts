/**
 * router.ts — Gelen soruyu Elfa mı Groq mu yönlendirecek karar verir.
 *
 * Kural:
 *   - Twitter/sosyal trend soruları  → Elfa  (1000 req/ay, cache 15dk)
 *   - Diğer her şey                  → Groq  (ücretsiz, cache 30dk)
 */

import { queryElfa, type ElfaResult } from './elfa';
import { queryGroq, type GroqResult } from './groq';

export type AIResult = ElfaResult | GroqResult;

/**
 * Sorunun Elfa'ya gitmesi gerekip gerekmediğini belirler.
 * Anahtar kelime tabanlı, kasıtlı olarak dar tutulmuştur —
 * Elfa kotasını korumak için yanlış pozitifleri minimumda tutar.
 */
function isElfaQuery(question: string): boolean {
  const q = question.toLowerCase();

  const elfaKeywords = [
    // Twitter / sosyal
    'twitter', 'tweet', 'trending', 'trend', 'viral',
    'most talked', 'en çok konuşulan', 'sosyal medya',
    'social media', 'hype', 'buzzing',
    // Duygu & akıllı para
    'sentiment', 'smart money', 'whale', 'influencer',
    'kol', 'alpha', 'narrative', 'narratives',
    // Haberler
    'news', 'haber', 'token news',
    // Trending
    'gündemde', 'popüler coin', 'viral coin',
    'hot coin', 'trending coin', 'most popular',
    'where is smart money', 'akıllı para',
    // Telegram
    'telegram',
  ];

  return elfaKeywords.some((kw) => q.includes(kw));
}

/** Ana router fonksiyonu — component ve API route buraya erişir */
export async function routeQuery(question: string, priceContext = ''): Promise<AIResult> {
  if (isElfaQuery(question)) {
    return queryElfa(question);
  }
  return queryGroq(question, priceContext);
}
