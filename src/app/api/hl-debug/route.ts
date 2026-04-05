import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const spotRes = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({type:'spotMetaAndAssetCtxs'}),
      signal: AbortSignal.timeout(10000),
    });
    const raw = await spotRes.json();
    // raw[0] = meta, raw[1] = ctxs
    const meta = raw[0];
    const ctxs = raw[1];

    const targets = ['USA500','US500','TSLA','NVDA','GOOGL','GOLD',
      'WTIOIL','EURUSD','USDJPY','SILVER','COPPER','NATGAS','PLATINUM',
      'URNM','HOOD','CRCL','cash','fix','flx','km','xyz','XAU','CL'];

    const tokenFound: string[] = [];
    const universeFound: string[] = [];

    for (const token of meta?.tokens ?? []) {
      const n = String(token.name ?? '');
      for (const t of targets) {
        if (n.toUpperCase().includes(t.toUpperCase())) {
          tokenFound.push(n); break;
        }
      }
    }
    for (const u of meta?.universe ?? []) {
      const n = String(u.name ?? '');
      for (const t of targets) {
        if (n.toUpperCase().includes(t.toUpperCase())) {
          universeFound.push(n); break;
        }
      }
    }

    // Tüm token isimlerini de gönder
    const allTokenNames = (meta?.tokens ?? []).map((t: {name?:string}) => t.name ?? '').sort();
    const allUniverseNames = (meta?.universe ?? []).map((u: {name?:string}) => u.name ?? '').sort();

    return NextResponse.json({
      tokenFound,
      universeFound,
      allTokenNames: allTokenNames.filter((n: string) => 
        ['USA','TSLA','NVDA','GOLD','SILVER','COPPER','EURUSD','USDJPY','GAS','OIL','cash','fix','flx','km','xyz']
        .some(t => n.toUpperCase().includes(t.toUpperCase()))
      ),
      allUniverseNames: allUniverseNames.filter((n: string) =>
        ['USA','TSLA','NVDA','GOLD','SILVER','COPPER','EURUSD','USDJPY','GAS','OIL','cash','fix','flx','km','xyz']
        .some(t => n.toUpperCase().includes(t.toUpperCase()))
      ),
      totalTokens: allTokenNames.length,
      totalUniverse: allUniverseNames.length,
    });
  } catch(e) {
    return NextResponse.json({error: String(e)});
  }
}
