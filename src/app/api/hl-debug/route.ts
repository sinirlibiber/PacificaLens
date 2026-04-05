import { NextResponse } from 'next/server';

export async function GET() {
  const types = ['spotMeta','spotMetaAndAssetCtxs','clearinghouseState','meta','metaAndAssetCtxs'];
  const results: Record<string, unknown> = {};

  await Promise.all(types.map(async (type) => {
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({type}),
        signal: AbortSignal.timeout(8000),
      });
      const raw = await res.json();
      // Sadece yapıyı göster, tam veri değil
      const summarize = (v: unknown, depth=0): unknown => {
        if (depth > 2) return '...';
        if (Array.isArray(v)) return `Array(${v.length}) [${summarize(v[0], depth+1)}]`;
        if (v && typeof v === 'object') {
          const keys = Object.keys(v as object);
          return keys.slice(0,5).reduce((acc: Record<string,unknown>, k) => {
            acc[k] = summarize((v as Record<string,unknown>)[k], depth+1);
            return acc;
          }, {});
        }
        return v;
      };
      
      // USA500, TSLA vs. ara
      const str = JSON.stringify(raw);
      const targets = ['USA500','TSLA','GOLD','EURUSD','SILVER','COPPER','NATGAS','PLATINUM'];
      const found = targets.filter(t => str.toUpperCase().includes(t.toUpperCase()));
      
      results[type] = { structure: summarize(raw), foundTargets: found };
    } catch(e) {
      results[type] = { error: String(e) };
    }
  }));

  return NextResponse.json(results);
}
