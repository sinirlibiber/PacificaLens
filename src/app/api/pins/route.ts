import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Lazy init — returns null if env vars are missing (graceful degradation)
function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET() {
  const supabase = getClient();
  // Supabase not configured — return empty list instead of crashing
  if (!supabase) {
    return NextResponse.json([]);
  }
  try {
    const { data, error } = await supabase
      .from('pins')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sunucu hatası';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = getClient();
  // Supabase not configured — pins cannot be saved without it
  if (!supabase) {
    return NextResponse.json(
      { error: 'Pin saving requires Supabase. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment.' },
      { status: 503 }
    );
  }
  try {
    const body = await req.json();
    const { label, lat, lng } = body;

    if (!label || lat == null || lng == null) {
      return NextResponse.json({ error: 'Eksik veri' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('pins')
      .insert([{ label: String(label).slice(0, 80), lat: Number(lat), lng: Number(lng) }])
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sunucu hatası';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
