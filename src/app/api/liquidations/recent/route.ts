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

  const hours  = Math.min(parseInt(req.nextUrl.searchParams.get('hours') || '1'), 168);
  const symbol = req.nextUrl.searchParams.get('symbol') || '';
  const since  = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  try {
    let query = supabase
      .from('liquidations')
      .select('symbol, side, notional, ts, cause')
      .gte('ts', since)
      .order('ts', { ascending: false })
      .limit(500);

    if (symbol) {
      // Match both "BTC" and "BTC-USD" formats
      const symUpper = symbol.toUpperCase().replace(/-USD$/i, '');
      query = query.or(`symbol.eq.${symUpper},symbol.eq.${symUpper}-USD`);
    }

    const { data, error } = await query;

    if (error) return NextResponse.json([]);
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json([]);
  }
}
