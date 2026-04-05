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

    // prefix'li sembolleri bul: xyz:, cash:, km:, flx:, fix:
    const hip3: {name:string; oi:string; mark:string; vol:string}[] = [];
    for (let i = 0; i < meta.universe.length; i++) {
      const name: string = meta.universe[i]?.name ?? '';
      if (name.includes(':')) {
        hip3.push({
          name,
          oi:   String(ctxs[i]?.openInterest ?? '0'),
          mark: String(ctxs[i]?.markPx ?? '0'),
          vol:  String(ctxs[i]?.dayNtlVlm ?? '0'),
        });
      }
    }

    return NextResponse.json({ hip3, total: hip3.length });
  } catch(e) {
    return NextResponse.json({error: String(e)});
  }
}
