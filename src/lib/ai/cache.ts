/**
 * cache.ts — Upstash Redis ile TTL-based cache
 * Env vars gerekli:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

async function redisCommand<T>(command: unknown[]): Promise<T | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    const json = await res.json();
    return json.result ?? null;
  } catch {
    return null;
  }
}

/** Cache'den oku. Yoksa null döner. */
export async function cacheGet(key: string): Promise<string | null> {
  return redisCommand<string>(['GET', key]);
}

/** Cache'e yaz. ttlSeconds sonra otomatik siler. */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  await redisCommand(['SET', key, value, 'EX', ttlSeconds]);
}

/** Cache key oluştur — soruyu normalize ederek hash'ler */
export function makeCacheKey(prefix: string, query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  // Basit ama yeterli hash: btoa ile encode
  const hash = Buffer.from(normalized).toString('base64').slice(0, 32);
  return `${prefix}:${hash}`;
}
