import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 20;

export interface LiqEvent {
  id: string; symbol: string; side: 'long'|'short'; price: number; notional: number; ts: number;
}
export interface LiqSymbolData {
  symbol: string; longLiq: number; shortLiq: number; total: number; count: number;
}

// HyperLiquid sembol → Pacifica sembol
// HIP-3 sembolleri xyz: prefix ile gelir
const HL_TO_PAC: Record<string,string> = {
  // HIP-3 (xyz: prefix) → Pacifica ismi
  'xyz:SP500':    'SP500',
  'xyz:GOLD':     'XAU',
  'xyz:CL':       'CL',
  'xyz:TSLA':     'TSLA',
  'xyz:NVDA':     'NVDA',
  'xyz:GOOGL':    'GOOGL',
  'xyz:PLTR':     'PLTR',
  'xyz:SILVER':   'SILVER',
  'xyz:COPPER':   'COPPER',
  'xyz:NATGAS':   'NATGAS',
  'xyz:PLATINUM': 'PLATINUM',
  'xyz:URNM':     'URNM',
  'xyz:HOOD':     'HOOD',
  'xyz:CRCL':     'CRCL',
  'xyz:EUR':      'EURUSD',
  'xyz:JPY':      'USDJPY',
  // kPEPE → PEPE, kBONK → BONK vs.
  'kPEPE':  'PEPE',
  'kBONK':  'BONK',
  'kSHIB':  'SHIB',
  'kFLOKI': 'FLOKI',
};

async function fetchHyperliquidLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  try {
    // İki endpoint paralel çek: normal kripto + xyz HIP-3
    const [cryptoRes, xyzRes] = await Promise.all([
      fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        signal: AbortSignal.timeout(10000),
      }),
      fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
        signal: AbortSignal.timeout(10000),
      }),
    ]);
    if (!cryptoRes.ok || !xyzRes.ok) return events;
    const [cryptoMeta, cryptoCtxs] = await cryptoRes.json();
    const [xyzMeta, xyzCtxs] = await xyzRes.json();
    // İkisini birleştir
    const universe = [
      ...(cryptoMeta?.universe ?? []),
      ...(xyzMeta?.universe ?? []),
    ];
    const ctxs = [
      ...(Array.isArray(cryptoCtxs) ? cryptoCtxs : []),
      ...(Array.isArray(xyzCtxs) ? xyzCtxs : []),
    ];
    const meta = { universe };
    if (!Array.isArray(universe) || !Array.isArray(ctxs)) return events;

    for (let i = 0; i < meta.universe.length; i++) {
      const hlRaw    = String(meta.universe[i]?.name ?? '');
      const ctx      = ctxs[i];
      if (!hlRaw || !ctx) continue;

      // Mapping'e bak, yoksa bare sembol kullan
      const pacSymbol = HL_TO_PAC[hlRaw]
        ?? hlRaw.replace(/^[a-z]+:/i, '').toUpperCase(); // xyz:SP500 → SP500

      if (!allowed.has(pacSymbol)) continue;

      const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
      const markPrice = parseFloat(String(ctx.markPx ?? '0'));
      if (!markPrice || openInt <= 0) continue;

      const funding  = parseFloat(String(ctx.funding ?? '0'));
      const liqRate  = Math.min(Math.max(Math.abs(funding) * 600 + 0.0015, 0.0015), 0.01);
      const totalLiq = openInt * markPrice * liqRate * (hours / 24);
      if (totalLiq <= 0) continue;

      const longBias = funding > 0 ? 0.65 : 0.35;
      const slices   = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = Date.now() - (h / slices) * hours * 3600 * 1000;
        const slice = totalLiq / slices;
        events.push({ id:`hl-${pacSymbol}-L-${h}`, symbol:pacSymbol, side:'long',  price:markPrice, notional:slice*longBias,      ts });
        events.push({ id:`hl-${pacSymbol}-S-${h}`, symbol:pacSymbol, side:'short', price:markPrice, notional:slice*(1-longBias), ts });
      }
    }
  } catch(e) { console.error('[liq-multi] HL:', e); }
  return events;
}

function buildSummary(events: LiqEvent[]): LiqSymbolData[] {
  const map = new Map<string,LiqSymbolData>();
  for (const e of events) {
    if (!map.has(e.symbol)) map.set(e.symbol, {symbol:e.symbol,longLiq:0,shortLiq:0,total:0,count:0});
    const s = map.get(e.symbol)!;
    if (e.side==='long') s.longLiq+=e.notional; else s.shortLiq+=e.notional;
    s.total+=e.notional; s.count++;
  }
  return Array.from(map.values()).filter(s=>s.total>0).sort((a,b)=>b.total-a.total);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours = Math.min(parseInt(searchParams.get('hours')||'24'), 168);
  const symbolsParam = searchParams.get('symbols') || '';
  const allowed = new Set(
    symbolsParam.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)
  );
  if (allowed.size === 0) {
    return NextResponse.json({summary:[],recent:[],pacificaSymbols:[],
      meta:{fetchedAt:Date.now(),hours,totalEvents:0,sources:{hyperliquid:0,pacifica:0}}});
  }
  try {
    const hlEvents = await fetchHyperliquidLiqs(hours, allowed);
    const summary  = buildSummary(hlEvents);
    const recent   = [...hlEvents].sort((a,b)=>b.ts-a.ts).slice(0,300);
    return NextResponse.json({
      summary, recent,
      pacificaSymbols: Array.from(allowed),
      meta:{fetchedAt:Date.now(),hours,totalEvents:hlEvents.length,
        sources:{hyperliquid:hlEvents.length,pacifica:0}},
    });
  } catch(err) {
    console.error('[liq-multi] fatal:', err);
    return NextResponse.json({summary:[],recent:[],pacificaSymbols:[],
      meta:{fetchedAt:Date.now(),hours,totalEvents:0,sources:{hyperliquid:0,pacifica:0}}});
  }
}
