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
import { getTickers } from '../pacifica';   // bir üst klasör

export type AIResult = ElfaResult | GeminiResult;

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

    // AGRESİF PROMPT – modelin kendi bilgilerini kullanmasını engeller
    const context = `
SADECE AŞAĞIDA VERDİĞİM GÜNCEL VERİLERİ KULLAN. KENDİ BİLGİLERİNİ KESİNLİKLE KULLANMA.

Güncel ${symbol} verileri (Pacifica DEX):
- Fiyat: ${ticker.mark} USD
- 24s Değişim: ${changePercent.toFixed(2)}%
- 24s Hacim: ${ticker.volume_24h}
- Fonlama Oranı: ${ticker.funding}
- Açık Pozisyon: ${ticker.open_interest}

Bu verilere göre kullanıcının sorusunu yanıtla. Yatırım tavsiyesi verme.
`;
    return `${context}\nKullanıcı sorusu: ${question}`;
  } catch (err) {
    console.error('Pacifica veri çekme hatası:', err);
    return question;
  }
}

export async function routeQuery(question: string): Promise<AIResult> {
  if (isElfaQuery(question)) {
    return queryElfa(question);
  }
  const enrichedQuestion = await enrichWithMarketData(question);
  return queryGemini(enrichedQuestion);
}
