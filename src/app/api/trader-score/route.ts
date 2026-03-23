import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { calculateScores } from '@/lib/traderScore';
import { LeaderboardEntry } from '@/hooks/useCopyTrading';

// ─── Fetch leaderboard from Pacifica ─────────────────────────────────────────

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const url = 'https://api.pacifica.fi/api/v1/leaderboard?limit=25000';
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const json = await res.json();

  const rawArr: Record<string, unknown>[] =
    json.success && Array.isArray(json.data) ? json.data :
    Array.isArray(json)                       ? json :
    json.data && Array.isArray(json.data)     ? json.data :
    [];

  return rawArr
    .map((d) => ({
      account:        String(d.address || d.account || d.wallet || ''),
      pnl_7d:         Number(d.pnl_7d ?? 0),
      pnl_30d:        Number(d.pnl_30d ?? 0),
      pnl_all:        Number(d.pnl_all_time ?? d.pnl_all ?? 0),
      volume_7d:      Number(d.volume_7d ?? 0),
      volume_30d:     Number(d.volume_30d ?? 0),
      volume_all:     Number(d.volume_all_time ?? d.volume_all ?? d.volume ?? 0),
      equity_current: Number(d.equity_current ?? 0),
      oi_current:     Number(d.oi_current ?? 0),
    }))
    .filter((e) => e.account.length > 0);
}

// ─── Cached score computation — revalidates every 12 hours ───────────────────

const getCachedScores = unstable_cache(
  async () => {
    const entries = await fetchLeaderboard();
    const scoreMap = calculateScores(entries);

    // Serialize Map → plain object for JSON response
    const scores: Record<string, { score: number; tier: string; breakdown: object; lastUpdated: number }> = {};
    scoreMap.forEach((v, k) => { scores[k] = v; });

    return { scores, computedAt: Date.now(), totalTraders: entries.length };
  },
  ['trader-scores-v1'],
  { revalidate: 43200 } // 12 hours in seconds
);

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  try {
    const data = await getCachedScores();
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[trader-score] Failed to compute scores:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// HEAD is called by the Vercel cron job to warm the cache
export async function HEAD() {
  try {
    await getCachedScores();
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
