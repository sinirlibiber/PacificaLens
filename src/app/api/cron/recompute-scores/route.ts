// Vercel cron bu endpoint'e günde bir kez GET isteği gönderir.
// vercel.json → { "path": "/api/cron/recompute-scores", "schedule": "0 6 * * *" }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { calculateScores } from '@/lib/traderScore';
import { setScoreStore } from '@/lib/scoreStore';
import { LeaderboardEntry } from '@/hooks/useCopyTrading';

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await fetch('https://api.pacifica.fi/api/v1/leaderboard?limit=25000', {
    headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const json = await res.json();

  const rawArr: Record<string, unknown>[] =
    json.success && Array.isArray(json.data) ? json.data :
    Array.isArray(json)                       ? json :
    json.data && Array.isArray(json.data)     ? json.data : [];

  return rawArr
    .map((d) => ({
      account:        String(d.address || d.account || d.wallet || '').toLowerCase(),
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

export async function GET(req: Request) {
  // Vercel cron Authorization: Bearer <CRON_SECRET> header'ı ekler
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const entries  = await fetchLeaderboard();
    const scoreMap = calculateScores(entries);

    const scores: Record<string, object> = {};
    scoreMap.forEach((v, k) => { scores[k] = v; });

    const payload = { scores, computedAt: Date.now(), totalTraders: entries.length };
    setScoreStore(payload);
    revalidateTag('trader-scores');

    console.log(`[cron] Recomputed ${entries.length} traders at ${new Date().toISOString()}`);
    return NextResponse.json({ success: true, computedAt: payload.computedAt, totalTraders: entries.length });
  } catch (err) {
    console.error('[cron] recompute-scores failed:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
