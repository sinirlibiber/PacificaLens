/**
 * router.ts — Gelen soruyu Elfa mı Groq mu yönlendirecek karar verir.
 * 
 * Kural:
 *   - Twitter/sosyal trend soruları  → Elfa  (1000 req/ay, cache 15dk)
 *   - Diğer her şey                  → Groq (ücretsiz, cache 5dk)
 * 
 * Güncelleme: Groq'a giden sorulara Pacifica'dan güncel piyasa verisi eklenir.
 */

import { queryElfa, type ElfaResult } from './elfa';
import { queryGemini, type GeminiResult } from './gemini';
import { getTickers } from './pacifica'; // Pacifica'dan ticker verilerini çekmek için

export type AIResult = ElfaResult | GeminiResult;

/**
 * Sorunun Elfa'ya gitmesi gerekip gerekmediğini belirler.
 * Anahtar kelime tabanlı, kasıtlı olarak dar tutulmuştur —
 * Elfa kotasını korumak için yanlış pozitifleri minimumda tutar.
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
 * Sadece BTC, ETH, SOL, DOGE, XRP, BNB gibi büyük coin'leri tanır.
 */
async function enrichWithMarketData(question: string): Promise<string> {
  // Büyük coin'leri yakalayan regex
  const symbolRegex = /\b(BTC|ETH|SOL|DOGE|XRP|BNB|ADA|AVAX|LINK|DOT|MATIC|NEAR|ATOM|ALGO|VET|FIL)\b/i;
  const match = question.match(symbolRegex);
  if (!match) return question; // Hiçbir coin geçmiyorsa olduğu gibi gönder

  const symbol = match[0].toUpperCase();

  try {
    const tickers = await getTickers(); // Tüm ticker'ları al
    const ticker = tickers[symbol];
    if (!ticker) return question; // O coin için veri yoksa olduğu gibi gönder

    // 24s değişim yüzdesini hesapla
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
    return question; // Hata durumunda soruyu olduğu gibi gönder
  }
}

/** Ana router fonksiyonu — component ve API route buraya erişir */
export async function routeQuery(question: string): Promise<AIResult> {
  if (isElfaQuery(question)) {
    return queryElfa(question);
  }

  // Diğer tüm sorular: önce piyasa verisi ekle, sonra Groq'a sor
  const enrichedQuestion = await enrichWithMarketData(question);
  return queryGemini(enrichedQuestion);
}
