/**
 * cache.ts — Upstash Redis ile TTL-based cache
 * Env vars gerekli:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Warn once at startup if Redis is not configured
if (!REDIS_URL || !REDIS_TOKEN) {
  console.warn(
    '[cache] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set. ' +
    'AI response caching is disabled — every request will hit Groq/Elfa directly. ' +
    'Set these in .env.local to enable caching and avoid rate-limit issues.'
  );
}

/** Upstash Redis REST API — GET */
export async function cacheGet(key: string): Promise<string | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const json = await res.json();
    return json.result ?? null;
  } catch {
    return null;
  }
}

/** Upstash Redis REST API — SET with EX */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    await fetch(
      `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      }
    );
  } catch {
    // Cache yazma hatası kritik değil, sessizce geç
  }
}

/** Cache key oluştur — soruyu normalize ederek hash'ler */
export function makeCacheKey(prefix: string, query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  // Basit ama yeterli hash: btoa ile encode
  const hash = Buffer.from(normalized).toString('base64').slice(0, 32);
  return `${prefix}:${hash}`;
}
