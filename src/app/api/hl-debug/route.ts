import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({type:'metaAndAssetCtxs', dex:'xyz'}),
      signal: AbortSignal.timeout(10000),
    });
    const [meta, ctxs] = await res.json();

    const targets = ['SP500','GOLD','CL','TSLA','NVDA','SILVER','COPPER','NATGAS','PLATINUM','URNM','HOOD','CRCL','EUR','JPY','GOOGL','PLTR'];
    const found: {name:string;oi:string;mark:string}[] = [];

    for (let i = 0; i < meta.universe.length; i++) {
      const name = String(meta.universe[i]?.name ?? '');
      for (const t of targets) {
        if (name.toUpperCase().includes(t.toUpperCase())) {
          found.push({name, oi: String(ctxs[i]?.openInterest??'0'), mark: String(ctxs[i]?.markPx??'0')});
          break;
        }
      }
    }

    return NextResponse.json({
      totalUniverse: meta.universe.length,
      found,
      first5: meta.universe.slice(0,5).map((u:{name:string}) => u.name),
    });
  } catch(e) {
    return NextResponse.json({error: String(e)});
  }
}
