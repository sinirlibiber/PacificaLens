/**
 * elfa.ts — Elfa AI v2 client
 * Social/trending sorular için kullanılır.
 * Elfa key yoksa veya hata alırsa Groq'a fallback yapar.
 *
 * Env var: ELFA_API_KEY
 */

import { cacheGet, cacheSet, makeCacheKey } from './cache';

const ELFA_BASE = 'https://api.elfa.ai';
const ELFA_KEY  = process.env.ELFA_API_KEY;
const CACHE_TTL = 900; // 15 dakika

const GROQ_KEY = process.env.GROQ_API_KEY!;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface ElfaResult {
  answer: string;
  source: 'elfa';
  cached: boolean;
}

// ── Elfa endpoint selector based on question ─────────────────────────────────

// Free plan endpoints (1,000 credits/mo):
//   ✅ trending-tokens  — /v2/aggregations/trending-tokens
//   ✅ token-news       — /v2/data/token-news
//   ✅ twitter-cas      — /v2/aggregations/trending-cas/twitter
//   ✅ telegram-cas     — /v2/aggregations/trending-cas/telegram
//   ❌ trending-narratives — Grow plan ($290/mo) only, NOT used

function pickElfaEndpoint(q: string): { url: string; label: string } {
  const lq = q.toLowerCase();

  if (lq.includes('news') || lq.includes('haber') || lq.includes('token news'))
    return { url: `${ELFA_BASE}/v2/data/token-news?limit=10`, label: 'token-news' };

  if (lq.includes('twitter') || lq.includes('tweet') || lq.includes('mention'))
    return { url: `${ELFA_BASE}/v2/aggregations/trending-cas/twitter`, label: 'twitter-cas' };

  if (lq.includes('telegram'))
    return { url: `${ELFA_BASE}/v2/aggregations/trending-cas/telegram`, label: 'telegram-cas' };

  // narrative/trend/gündem → trending-tokens (narratives endpoint is Grow plan only)
  return { url: `${ELFA_BASE}/v2/aggregations/trending-tokens?timeWindow=24h`, label: 'trending-tokens' };
}

// ── Format Elfa response into readable text ───────────────────────────────────

function formatElfaData(label: string, data: unknown): string {
  const arr: Record<string, unknown>[] =
    Array.isArray((data as Record<string, unknown>)?.data) ? (data as Record<string, unknown[]>).data as Record<string, unknown>[] :
    Array.isArray(data) ? data as Record<string, unknown>[] : [];

  if (!arr.length) throw new Error('Empty Elfa response');

  if (label === 'trending-tokens') {
    const list = arr.slice(0, 10).map((t, i) => {
      const sym      = String(t.token ?? t.symbol ?? t.name ?? '?');
      const mentions = Number(t.mentions ?? t.mention_count ?? 0);
      const change   = Number(t.change_percent ?? 0);
      const changeStr = change ? ` ${change > 0 ? '+' : ''}${change.toFixed(1)}%` : '';
      return `${i + 1}. $${sym}${mentions ? ` — ${mentions.toLocaleString()} mentions` : ''}${changeStr}`;
    }).join('\n');
    return `🔥 Trending tokens on crypto social media (last 24h):\n\n${list}`;
  }

  if (label === 'narratives') {
    const list = arr.slice(0, 8).map((n, i) => {
      const name  = String(n.narrative ?? n.name ?? n.title ?? '?');
      const score = Number(n.score ?? n.mentions ?? 0);
      return `${i + 1}. ${name}${score ? ` (score: ${score})` : ''}`;
    }).join('\n');
    return `📈 Trending narratives right now:\n\n${list}`;
  }

  if (label === 'token-news') {
    const list = arr.slice(0, 6).map((n, i) => {
      const title  = String(n.title ?? n.headline ?? '?');
      const source = String(n.source ?? '');
      return `${i + 1}. ${title}${source ? ` (${source})` : ''}`;
    }).join('\n');
    return `📰 Latest crypto token news:\n\n${list}`;
  }

  if (label === 'twitter-cas' || label === 'telegram-cas') {
    const platform = label === 'twitter-cas' ? 'Twitter/X' : 'Telegram';
    const list = arr.slice(0, 10).map((t, i) => {
      const sym  = String(t.token ?? t.symbol ?? t.ca ?? t.address ?? '?');
      const hits = Number(t.mentions ?? t.count ?? 0);
      return `${i + 1}. ${sym}${hits ? ` — ${hits.toLocaleString()} mentions` : ''}`;
    }).join('\n');
    return `🔥 Trending on ${platform} right now:\n\n${list}`;
  }

  // Generic fallback format
  return `Social data (${label}):\n${JSON.stringify(arr.slice(0, 5), null, 2)}`;
}

// ── Groq fallback for social queries ─────────────────────────────────────────

async function queryGroqForSocial(userQuestion: string): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are an elite crypto market analyst and on-chain intelligence expert built into PacificaLens, a perpetuals DEX trading platform.

Your expertise:
- Deep knowledge of crypto market cycles, whale behavior, and institutional flow patterns
- Smart money tracking: You understand how large players accumulate quietly (low volume, tight spreads, no social noise), then exit loudly into retail hype
- Narrative cycles: You know which meta-narratives (AI tokens, RWA, DePIN, LSTfi, memecoins) dominate at different market phases
- Social signal interpretation: Even without live data, you can reason about WHERE smart money attention flows based on macro conditions, sector rotations, and historical patterns
- On-chain behavioral patterns: wallet clustering, exchange outflows, derivatives funding rates, liquidation cascades

When answering questions about trending tokens, smart money, whale activity, or social sentiment:
1. Give SPECIFIC, actionable insights — not vague generalities
2. Reference concrete behavioral patterns (e.g., "smart money typically front-runs narrative shifts 2-4 weeks before retail")
3. Name specific sectors/tokens that historically attract institutional attention in current macro conditions
4. Explain the WHY behind movements, not just the what
5. Reason from market structure and patterns — state "Based on current market structure..." instead of disclaimers

CRITICAL: Never say "I don't have real-time social data" — this is useless to a trader. Instead, reason from what you know and provide actionable analysis.
CRITICAL: Always respond in the exact same language the user writes in. Turkish → Turkish. English → English.`,
        },
        { role: 'user', content: userQuestion },
      ],
      max_tokens: 600,
      temperature: 0.65,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Groq error: ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? 'No response.';
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function queryElfa(userQuestion: string): Promise<ElfaResult> {
  const cacheKey = makeCacheKey('elfa', userQuestion);

  const cached = await cacheGet(cacheKey);
  if (cached) return { answer: cached, source: 'elfa', cached: true };

  let answer: string;

  if (ELFA_KEY) {
    try {
      const { url, label } = pickElfaEndpoint(userQuestion);
      const res = await fetch(url, {
        headers: { 'x-elfa-api-key': ELFA_KEY, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`Elfa ${res.status}`);
      const data = await res.json();
      answer = formatElfaData(label, data);
    } catch {
      // Silently fallback to Groq
      answer = await queryGroqForSocial(userQuestion);
    }
  } else {
    answer = await queryGroqForSocial(userQuestion);
  }

  await cacheSet(cacheKey, answer, CACHE_TTL);
  return { answer, source: 'elfa', cached: false };
}
