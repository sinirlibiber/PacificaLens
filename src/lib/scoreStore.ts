// Serverless ortamında her instance kendi belleğinde bu store'u tutar.
// Cron her gün setScoreStore() ile günceller; GET handler getScoreStore() ile okur.
// Instance soğuksa (ilk istek) store null gelir → GET handler o zaman kendi hesaplar.

export interface ScorePayload {
  scores:       Record<string, object>;
  computedAt:   number;
  totalTraders: number;
}

let store: ScorePayload | null = null;

export function getScoreStore(): ScorePayload | null {
  return store;
}

export function setScoreStore(payload: ScorePayload): void {
  store = payload;
}
