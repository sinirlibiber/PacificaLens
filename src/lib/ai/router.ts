/**
 * router.ts — Gelen soruyu Elfa mı Gemini mi yönlendirecek karar verir.
 *
 * Kural:
 *   - Twitter/sosyal trend soruları  → Elfa  (1000 req/ay, cache 15dk)
 *   - Diğer her şey                  → Gemini (ücretsiz, cache 5dk)
 */

import { queryElfa, type ElfaResult }   from './elfa';
import { queryGemini, type GeminiResult } from './gemini';

export type AIResult = ElfaResult | GeminiResult;

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
    'kol', 'alpha', 'narrative',
    // Türkçe trend ifadeler
    'gündemde', 'popüler coin', 'viral coin',
  ];

  return elfaKeywords.some((kw) => q.includes(kw));
}

/** Ana router fonksiyonu — component ve API route buraya erişir */
export async function routeQuery(question: string, priceContext = ''): Promise<AIResult> {
  if (isElfaQuery(question)) {
    return queryElfa(question);
  }
  return queryGemini(question, priceContext);
}
