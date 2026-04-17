export const runtime = 'edge';
export const revalidate = 2;

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path') || '';
  const url = `https://api.pacifica.fi/api/v1/${path}`;
  try {
    // Forward relevant headers so authenticated endpoints work
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    const origin = request.headers.get('origin');
    if (origin) headers['Referer'] = origin;

    const res = await fetch(url, {
      next: { revalidate: 3 },
      headers,
    });

    // Pass through status so caller can detect auth errors
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
