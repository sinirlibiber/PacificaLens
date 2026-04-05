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

    // Tüm sembolleri döndür — filtresiz
    const all = meta.universe.map((u: {name:string; szDecimals:number}, i: number) => ({
      name: u.name,
      oi:   String(ctxs[i]?.openInterest ?? '0'),
      mark: String(ctxs[i]?.markPx ?? '0'),
      vol:  String(ctxs[i]?.dayNtlVlm ?? '0'),
    }));

    // Sadece : içerenleri filtrele
    const withColon = all.filter((x: {name:string}) => x.name.includes(':'));
    
    // SP500, GOLD, CL içerenleri filtrele  
    const targets = ['SP500','GOLD','CL','SILVER','COPPER','TSLA','NVDA','EURUSD','USDJPY','NATGAS','PLATINUM','USA500','EUR'];
    const withTarget = all.filter((x: {name:string}) => 
      targets.some(t => x.name.toUpperCase().includes(t.toUpperCase()))
    );

    return NextResponse.json({ 
      withColon,
      withTarget,
      totalUniverse: meta.universe.length,
      first10: all.slice(0,10),
    });
  } catch(e) {
    return NextResponse.json({error: String(e)});
  }
}
