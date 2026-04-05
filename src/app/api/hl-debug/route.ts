import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({type:'metaAndAssetCtxs'}),
      signal: AbortSignal.timeout(10000),
    });
    const [meta, ctxs] = await res.json();

    // xyz: prefix içeren TÜM sembolleri bul
    const xyzSymbols: {name:string;oi:string;mark:string}[] = [];
    // İlk 10 sembolü göster (format kontrolü)
    const first10 = meta.universe.slice(0,10).map((u: {name:string}, i: number) => ({
      name: u.name,
      hasColon: u.name.includes(':'),
      oi: String(ctxs[i]?.openInterest ?? '0'),
    }));

    for (let i = 0; i < meta.universe.length; i++) {
      const name = String(meta.universe[i]?.name ?? '');
      if (name.includes(':')) {
        xyzSymbols.push({
          name,
          oi:   String(ctxs[i]?.openInterest ?? '0'),
          mark: String(ctxs[i]?.markPx ?? '0'),
        });
      }
    }

    return NextResponse.json({
      totalUniverse: meta.universe.length,
      xyzCount: xyzSymbols.length,
      xyzSymbols: xyzSymbols.slice(0,20),
      first10,
    });
  } catch(e) {
    return NextResponse.json({error: String(e)});
  }
}
