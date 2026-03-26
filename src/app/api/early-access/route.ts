import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const body = await req.json();

  // JOIN WAITLIST
  if (body.action === 'join') {
    const email = (body.email ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    const { error } = await supabase.from('early_access_waitlist').insert({ email });
    if (error && error.code !== '23505') {
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // VERIFY CODE
  if (body.action === 'verify') {
    const code = (body.code ?? '').trim().toUpperCase();
    if (!code) return NextResponse.json({ valid: false, error: 'No code' }, { status: 200 });

    const { data, error } = await supabase
      .from('invite_codes')
      .select('id, used')
      .eq('code', code)
      .single();

    if (error || !data) return NextResponse.json({ valid: false, error: 'Invalid code' });
    if (data.used) return NextResponse.json({ valid: false, error: 'Code already used' });

    await supabase
      .from('invite_codes')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', data.id);

    return NextResponse.json({ valid: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
