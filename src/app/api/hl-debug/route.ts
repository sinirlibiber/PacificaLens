import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Hem perp hem spot meta dene
    const [perpRes, spotRes] = await Promise.all([
      fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({type:'metaAndAssetCtxs'}),
        signal: AbortSignal.timeout(10000),
      }),
      fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({type:'spotMetaAndAssetCtxs'}),
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    const perpData = await perpRes.json();
    const spotData = await spotRes.json();

    const targets = ['SP500','USA500','US500','TSLA','NVDA','GOOGL','GOLD','XAU',
      'WTIOIL','CL','EURUSD','USDJPY','SILVER','COPPER','NATGAS','PLATINUM',
      'URNM','HOOD','CRCL','cash','fix','flx','km','xyz'];

    // Perp universe
    const perpFound: string[] = [];
    const [meta] = perpData;
    for (const u of meta?.universe ?? []) {
      const n = u.name ?? '';
      for (const t of targets) {
        if (n.toUpperCase().includes(t.toUpperCase())) {
          perpFound.push(n);
          break;
        }
      }
    }

    // Spot universe
    const spotFound: string[] = [];
    for (const token of spotData?.tokens ?? []) {
      const n = token.name ?? '';
      for (const t of targets) {
        if (n.toUpperCase().includes(t.toUpperCase())) {
          spotFound.push(n);
          break;
        }
      }
    }
    // Spot universe2
    for (const u of spotData?.universe ?? []) {
      const n = u.name ?? '';
      for (const t of targets) {
        if (n.toUpperCase().includes(t.toUpperCase())) {
          if (!spotFound.includes(n)) spotFound.push(n);
          break;
        }
      }
    }

    return NextResponse.json({
      perpFound,
      spotFound,
      spotKeys: Object.keys(spotData ?? {}),
      spotTokensCount: spotData?.tokens?.length ?? 0,
      spotUniverseCount: spotData?.universe?.length ?? 0,
    });
  } catch(e) {
    return NextResponse.json({error: String(e)});
  }
}
