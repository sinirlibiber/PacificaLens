export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { calculateScores } from '@/lib/traderScore';
import { getScoreStore, setScoreStore } from '@/lib/scoreStore';
import { LeaderboardEntry } from '@/hooks/useCopyTrading';

// ─── Fetch leaderboard from Pacifica ─────────────────────────────────────────

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
      // toLowerCase() — adres case uyumsuzluğunu önler
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

// ─── GET — kullanıcı isteği ───────────────────────────────────────────────────
// 1. scoreStore'da veri varsa (cron bugün çalıştıysa) → anında dön
// 2. Store boşsa (instance yeni ayağa kalktıysa) → hesapla, store'a yaz, dön

export async function GET() {
  try {
    let data = getScoreStore();

    if (!data) {
      // Cold start: instance yeni, henüz cron çalışmamış
      // Hesapla ve store'a yaz (sonraki istekler anında döner)
      const entries  = await fetchLeaderboard();
      const scoreMap = calculateScores(entries);
      const scores: Record<string, object> = {};
      scoreMap.forEach((v, k) => { scores[k] = v; });
      data = { scores, computedAt: Date.now(), totalTraders: entries.length };
      setScoreStore(data);
    }

    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[trader-score] GET failed:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// HEAD — geriye dönük uyumluluk (eski cron çağrıları için)
export async function HEAD() {
  try {
    if (!getScoreStore()) {
      const entries  = await fetchLeaderboard();
      const scoreMap = calculateScores(entries);
      const scores: Record<string, object> = {};
      scoreMap.forEach((v, k) => { scores[k] = v; });
      setScoreStore({ scores, computedAt: Date.now(), totalTraders: entries.length });
    }
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
