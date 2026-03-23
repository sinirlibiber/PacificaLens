/**
 * router.ts — Gelen soruyu Elfa mı Gemini mi yönlendirecek karar verir.
 * 
 * Kural:
 *   - Twitter/sosyal trend soruları  → Elfa  (1000 req/ay, cache 15dk)
 *   - Diğer her şey                  → Gemini (ücretsiz, cache 5dk)
 * 
 * Güncelleme: Gemini'ye giden sorulara Pacifica'dan güncel piyasa verisi eklenir.
 */

import { queryElfa, type ElfaResult } from './elfa';
import { queryGemini, type GeminiResult } from './gemini';
import { getTickers } from './pacifica';

export type AIResult = ElfaResult | GeminiResult;

/**
 * Sorunun Elfa'ya gitmesi gerekip gerekmediğini belirler.
 */
function isElfaQuery(question: string): boolean {
  const q = question.toLowerCase();

  const elfaKeywords = [
    'twitter', 'tweet', 'trending', 'trend', 'viral',
    'most talked', 'en çok konuşulan', 'sosyal medya',
    'social media', 'hype', 'buzzing',
    'sentiment', 'smart money', 'whale', 'influencer',
    'kol', 'alpha', 'narrative',
    'gündemde', 'popüler coin', 'viral coin',
  ];

  return elfaKeywords.some((kw) => q.includes(kw));
}

/**
 * Pacifica'dan güncel piyasa verilerini çekip prompt'a ekler.
 */
async function enrichWithMarketData(question: string): Promise<string> {
  const symbolRegex = /\b(BTC|ETH|SOL|DOGE|XRP|BNB|ADA|AVAX|LINK|DOT|MATIC|NEAR|ATOM|ALGO|VET|FIL)\b/i;
  const match = question.match(symbolRegex);
  if (!match) return question;

  const symbol = match[0].toUpperCase();

  try {
    const tickers = await getTickers();
    const ticker = tickers[symbol];
    if (!ticker) return question;

    const yesterdayPrice = parseFloat(ticker.yesterday_price);
    const currentPrice = parseFloat(ticker.mark);
    const changePercent = yesterdayPrice
      ? ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100
      : 0;

    const context = `
Güncel ${symbol} verileri (Pacifica DEX):
- Fiyat (mark): ${ticker.mark} USD
- 24s Değişim: ${changePercent.toFixed(2)}%
- 24s Hacim: ${ticker.volume_24h}
- Fonlama Oranı: ${ticker.funding}
- Açık Pozisyon (OI): ${ticker.open_interest}

Lütfen bu güncel verilere dayanarak kısa bir analiz yap. Yatırım tavsiyesi verme, sadece verileri yorumla.
`;
    return `${context}\nKullanıcı sorusu: ${question}`;
  } catch (err) {
    console.error('Pacifica veri çekme hatası:', err);
    return question;
  }
}

/** Ana router fonksiyonu */
export async function routeQuery(question: string): Promise<AIResult> {
  if (isElfaQuery(question)) {
    return queryElfa(question);
  }

  const enrichedQuestion = await enrichWithMarketData(question);
  return queryGemini(enrichedQuestion);
}
