import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 20;

export interface LiqEvent {
  id: string; symbol: string; side: 'long'|'short'; price: number; notional: number; ts: number;
}
export interface LiqSymbolData {
  symbol: string; longLiq: number; shortLiq: number; total: number; count: number;
}

// HL sembol adı → Pacifica'daki görünen isim
// Sadece ismi farklı olanlar burada, aynı olanlar zaten doğru gelir
const HL_TO_PAC: Record<string, string> = {
  'USA500-USDT':'SP500','USA500-USDC':'SP500','USA500':'SP500',
  'GOLD-USDC':'XAU','GOLD-USDT':'XAU','GOLD':'XAU',
  'WTIOIL-USDC':'CL','WTIOIL-USDT':'CL','WTIOIL':'CL',
  'TSLA-USDT':'TSLA','TSLA-USDC':'TSLA',
  'USDJPY-USDC':'USDJPY','USDJPY-USDT':'USDJPY',
  'EURUSD-USDC':'EURUSD','EURUSD-USDT':'EURUSD',
  'GOOGL-USDC':'GOOGL','GOOGL-USDT':'GOOGL',
  'NVDA-USDT':'NVDA','NVDA-USDC':'NVDA',
  'PLTR-USDC':'PLTR','PLTR-USDT':'PLTR',
  'PLATINUM-USDC':'PLATINUM','PLATINUM-USDT':'PLATINUM',
  'URNM-USDC':'URNM','URNM-USDT':'URNM',
  'COPPER-USDC':'COPPER','COPPER-USDT':'COPPER',
  'SILVER-USDC':'SILVER','SILVER-USDT':'SILVER',
  'NATGAS-USDC':'NATGAS','NATGAS-USDT':'NATGAS',
  'CRCL-USDC':'CRCL','CRCL-USDT':'CRCL',
  'HOOD-USDT':'HOOD','HOOD-USDC':'HOOD',
};

// Pacifica'daki tüm semboller (HeatmapView'dan symbols parametresiyle gelir)
// Fallback: bu sabit liste — Pacifica Overview'da görünen 61+2=63 market
const PACIFICA_SYMBOLS = new Set([
  'BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','LINK','DOT',
  'BNB','LTC','BCH','UNI','ATOM','NEAR','APT','ARB','OP',
  'SUI','TRX','HYPE','PEPE','WIF','JUP','SEI','INJ','TIA',
  'WLD','BLUR','PENDLE','GMX','DYDX','RUNE','RNDR','FET',
  'MATIC','TON','BONK','PYTH','W','ALT','STRK','ZEC','ASTER',
  'LIT','PAXG','ZRO','VIRTUAL','FARTCOIN','AI16Z','TRUMP',
  'BP','PIPPIN',
  // Görseldeki HL-mapped marketler — Pacifica'daki isimlerle
  'SP500','XAU','CL','TSLA','USDJPY','EURUSD',
  'GOOGL','NVDA','PLTR','PLATINUM','URNM','COPPER',
  'SILVER','NATGAS','CRCL','HOOD',
]);

async function fetchHyperliquidLiqs(hours: number, allowed: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return events;
    const [meta, ctxs] = await res.json();
    if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) return events;

    for (let i = 0; i < meta.universe.length; i++) {
      const hlRaw    = String(meta.universe[i]?.name ?? '');
      const ctx      = ctxs[i];
      if (!hlRaw || !ctx) continue;

      // 1. Mapping'e bak (USA500-USDT → SP500)
      // 2. Yoksa bare sembol kullan (BTC-USDT → BTC)
      const pacSymbol = HL_TO_PAC[hlRaw]
        ?? hlRaw.replace(/-(USDT|USDC|USDH|USD)$/i, '').toUpperCase();

      // Pacifica'da olmayan semboller → atla
      if (!allowed.has(pacSymbol)) continue;

      const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
      const markPrice = parseFloat(String(ctx.markPx ?? '0'));
      if (!markPrice || openInt <= 0) continue;

      const funding  = parseFloat(String(ctx.funding ?? '0'));
      const liqRate  = Math.min(Math.max(Math.abs(funding) * 600 + 0.0015, 0.0015), 0.01);
      const totalLiq = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
      if (totalLiq <= 0) continue;

      const longBias = funding > 0 ? 0.65 : 0.35;
      const slices   = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = Date.now() - (h / slices) * hours * 3600 * 1000;
        const slice = totalLiq / slices;
        events.push({ id:`hl-${pacSymbol}-L-${h}`, symbol:pacSymbol, side:'long',  price:markPrice, notional:slice*longBias,       ts });
        events.push({ id:`hl-${pacSymbol}-S-${h}`, symbol:pacSymbol, side:'short', price:markPrice, notional:slice*(1-longBias), ts });
      }
    }
  } catch(e) { console.error('[liq-multi] HL:', e); }
  return events;
}

function buildSummary(events: LiqEvent[]): LiqSymbolData[] {
  const map = new Map<string, LiqSymbolData>();
  for (const e of events) {
    if (!map.has(e.symbol)) map.set(e.symbol, { symbol:e.symbol, longLiq:0, shortLiq:0, total:0, count:0 });
    const s = map.get(e.symbol)!;
    if (e.side==='long') s.longLiq+=e.notional; else s.shortLiq+=e.notional;
    s.total+=e.notional; s.count++;
  }
  return Array.from(map.values()).filter(s=>s.total>0).sort((a,b)=>b.total-a.total);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours = Math.min(parseInt(searchParams.get('hours')||'24'), 168);

  // HeatmapView'dan gelen symbols parametresi varsa onu kullan
  // Yoksa PACIFICA_SYMBOLS sabit listesini kullan
  const symbolsParam = searchParams.get('symbols') || '';
  const allowed: Set<string> = symbolsParam
    ? new Set(symbolsParam.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean))
    : PACIFICA_SYMBOLS;

  try {
    const hlEvents = await fetchHyperliquidLiqs(hours, allowed);
    const summary  = buildSummary(hlEvents);
    const recent   = [...hlEvents].sort((a,b)=>b.ts-a.ts).slice(0,300);
    return NextResponse.json({
      summary, recent,
      pacificaSymbols: Array.from(allowed),
      meta: { fetchedAt:Date.now(), hours, totalEvents:hlEvents.length, sources:{hyperliquid:hlEvents.length, pacifica:0} },
    });
  } catch(err) {
    console.error('[liq-multi] fatal:', err);
    return NextResponse.json({ summary:[], recent:[], pacificaSymbols:[],
      meta:{fetchedAt:Date.now(), hours, totalEvents:0, sources:{hyperliquid:0,pacifica:0}} });
  }
}
