import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Lazy init — build sırasında değil, istek geldiğinde oluşturulur
function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY env değişkenleri eksik');
  }
  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = getClient();
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
  try {
    const supabase = getClient();
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
