import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// GET /api/liquidations/recent?hours=1
// Returns individual liquidation events (not aggregated) for recent panel
export async function GET(req: NextRequest) {
  const supabase = getClient();
  if (!supabase) return NextResponse.json([]);

  const hours = Math.min(parseInt(req.nextUrl.searchParams.get('hours') || '1'), 24);
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from('liquidations')
      .select('symbol, side, notional, ts, cause')
      .gte('ts', since)
      .order('ts', { ascending: false })
      .limit(50);

    if (error) return NextResponse.json([]);
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json([]);
  }
}
