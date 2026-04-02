import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// GET /api/liquidations?hours=24
// Returns aggregated liq data per symbol for the last N hours
export async function GET(req: NextRequest) {
  const supabase = getClient();
  if (!supabase) return NextResponse.json([], { status: 200 });

  const hours = Math.min(parseInt(req.nextUrl.searchParams.get('hours') || '24'), 168);
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from('liquidations')
      .select('symbol, side, notional')
      .gte('ts', since);

    if (error) return NextResponse.json([], { status: 200 });

    // Aggregate per symbol
    const agg: Record<string, { symbol: string; longLiq: number; shortLiq: number; total: number; count: number }> = {};
    for (const row of (data || [])) {
      if (!agg[row.symbol]) agg[row.symbol] = { symbol: row.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 };
      const isLong = row.side?.includes('long');
      const n = Number(row.notional) || 0;
      if (isLong) agg[row.symbol].longLiq += n;
      else        agg[row.symbol].shortLiq += n;
      agg[row.symbol].total += n;
      agg[row.symbol].count++;
    }

    const result = Object.values(agg).sort((a, b) => b.total - a.total);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

// POST /api/liquidations
// Body: { events: Array<{ symbol, side, price, amount, notional, ts, cause, trade_id }> }
export async function POST(req: NextRequest) {
  const supabase = getClient();
  if (!supabase) return NextResponse.json({ ok: false, reason: 'no_supabase' });

  try {
    const { events } = await req.json();
    if (!Array.isArray(events) || events.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

    const rows = events.map((e: {
      symbol: string; side: string; price: number; amount: number;
      notional: number; ts: number; cause: string; trade_id: string;
    }) => ({
      trade_id: e.trade_id,
      symbol:   e.symbol,
      side:     e.side,
      price:    e.price,
      amount:   e.amount,
      notional: e.notional,
      cause:    e.cause,
      ts:       new Date(e.ts).toISOString(),
    }));

    // upsert — ignore duplicates by trade_id
    const { error } = await supabase
      .from('liquidations')
      .upsert(rows, { onConflict: 'trade_id', ignoreDuplicates: true });

    if (error) return NextResponse.json({ ok: false, error: error.message });
    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
