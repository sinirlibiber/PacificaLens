import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(10000),
    });
    const [meta, ctxs] = await res.json();
    
    const targets = ['SP500','USA500','GOLD','XAU','WTIOIL','CL','TSLA',
      'NVDA','GOOGL','PLTR','EURUSD','USDJPY','SILVER','COPPER',
      'NATGAS','PLATINUM','URNM','HOOD','CRCL'];
    
    const found: Record<string, {oi:string;mark:string;vol:string}> = {};
    const allNames: string[] = [];
    
    for (let i = 0; i < meta.universe.length; i++) {
      const name = meta.universe[i]?.name ?? '';
      allNames.push(name);
      const upper = name.toUpperCase();
      for (const t of targets) {
        if (upper.includes(t) || t.includes(upper)) {
          found[name] = {
            oi:   String(ctxs[i]?.openInterest ?? '?'),
            mark: String(ctxs[i]?.markPx ?? '?'),
            vol:  String(ctxs[i]?.dayNtlVlm ?? '?'),
          };
        }
      }
    }
    
    return NextResponse.json({ found, totalSymbols: allNames.length, allNames: allNames.sort() });
  } catch(e) {
    return NextResponse.json({ error: String(e) });
  }
}
