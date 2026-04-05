/**
 * GET /api/liq-multi?hours=24
 * HyperLiquid + Pacifica liq data
 * Sadece Pacifica'da gerçekten listelenen marketler gösterilir.
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 20;

export interface LiqEvent {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  price: number;
  notional: number;
  ts: number;
}
export interface LiqSymbolData {
  symbol: string;
  longLiq: number;
  shortLiq: number;
  total: number;
  count: number;
}

// HyperLiquid sembol adı → Pacifica sembol adı
// HL'de birden fazla pair olabilir (USDT/USDC/USDH), hepsi aynı Pacifica sembolüne map edilir
const HL_TO_PAC: Record<string, string> = {
  // SP500
  'USA500-USDT': 'SP500', 'USA500-USDC': 'SP500', 'USA500-USDH': 'SP500', 'USA500': 'SP500',
  // XAU (Altın)
  'GOLD-USDC': 'XAU', 'GOLD-USDT': 'XAU', 'GOLD-USDH': 'XAU', 'GOLD': 'XAU',
  // CL (Ham petrol)
  'WTIOIL-USDC': 'CL', 'WTIOIL-USDT': 'CL', 'WTIOIL-USDH': 'CL', 'WTIOIL': 'CL',
  // TSLA
  'TSLA-USDT': 'TSLA', 'TSLA-USDC': 'TSLA', 'TSLA-USDH': 'TSLA',
  // USDJPY
  'USDJPY-USDC': 'USDJPY', 'USDJPY-USDT': 'USDJPY', 'USDJPY-USDH': 'USDJPY',
  // EURUSD
  'EURUSD-USDC': 'EURUSD', 'EURUSD-USDT': 'EURUSD', 'EURUSD-USDH': 'EURUSD',
  // GOOGL
  'GOOGL-USDC': 'GOOGL', 'GOOGL-USDT': 'GOOGL', 'GOOGL-USDH': 'GOOGL',
  // NVDA
  'NVDA-USDT': 'NVDA', 'NVDA-USDC': 'NVDA', 'NVDA-USDH': 'NVDA',
  // PLTR
  'PLTR-USDC': 'PLTR', 'PLTR-USDT': 'PLTR', 'PLTR-USDH': 'PLTR',
  // PLATINUM
  'PLATINUM-USDC': 'PLATINUM', 'PLATINUM-USDT': 'PLATINUM', 'PLATINUM-USDH': 'PLATINUM',
  // URNM
  'URNM-USDC': 'URNM', 'URNM-USDT': 'URNM', 'URNM-USDH': 'URNM',
  // COPPER
  'COPPER-USDC': 'COPPER', 'COPPER-USDT': 'COPPER', 'COPPER-USDH': 'COPPER',
  // SILVER
  'SILVER-USDC': 'SILVER', 'SILVER-USDT': 'SILVER', 'SILVER-USDH': 'SILVER',
  // NATGAS
  'NATGAS-USDC': 'NATGAS', 'NATGAS-USDT': 'NATGAS', 'NATGAS-USDH': 'NATGAS',
  // CRCL
  'CRCL-USDC': 'CRCL', 'CRCL-USDT': 'CRCL', 'CRCL-USDH': 'CRCL',
  // HOOD
  'HOOD-USDT': 'HOOD', 'HOOD-USDC': 'HOOD', 'HOOD-USDH': 'HOOD',
};

// Pacifica'daki gerçek market listesi — API'den çekilemezse kullanılır
// Bunlar Pacifica Overview'da görünen semboller
const PACIFICA_MARKETS = [
  // Kripto
  'BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','ADA-USD','AVAX-USD','LINK-USD','DOT-USD',
  'BNB-USD','LTC-USD','BCH-USD','UNI-USD','ATOM-USD','NEAR-USD','APT-USD','ARB-USD','OP-USD',
  'SUI-USD','TRX-USD','HYPE-USD','PEPE-USD','WIF-USD','JUP-USD','SEI-USD','INJ-USD','TIA-USD',
  'WLD-USD','BLUR-USD','PENDLE-USD','GMX-USD','DYDX-USD','RUNE-USD','RNDR-USD','FET-USD',
  'MATIC-USD','TON-USD','BONK-USD','PYTH-USD','W-USD','ALT-USD','STRK-USD','ZEC-USD','ASTER-USD',
  'LIT-USD','PAXG-USD','ZRO-USD','VIRTUAL-USD','FARTCOIN-USD','AI16Z-USD','TRUMP-USD',
  // Hisse/Emtia/Forex (Pacifica sembol adları)
  'SP500-USD','XAU-USD','CL-USD','TSLA-USD','USDJPY-USD','EURUSD-USD',
  'GOOGL-USD','NVDA-USD','PLTR-USD','PLATINUM-USD','URNM-USD','COPPER-USD',
  'SILVER-USD','NATGAS-USD','CRCL-USD','HOOD-USD',
];

// Pacifica API'den gerçek sembol listesini çek, başarısız olursa PACIFICA_MARKETS kullan
async function fetchPacificaSymbols(): Promise<Set<string>> {
  try {
    const res = await fetch('https://api.pacifica.fi/api/v1/info', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('not ok');
    const json = await res.json();
    const markets: { symbol?: string }[] = json?.data ?? json ?? [];
    if (!Array.isArray(markets) || markets.length < 5) throw new Error('empty');
    const set = new Set<string>();
    for (const m of markets) {
      if (m.symbol) set.add(m.symbol.toUpperCase()); // BTC-USD formatında
    }
    return set;
  } catch {
    // Fallback: PACIFICA_MARKETS listesini kullan
    return new Set(PACIFICA_MARKETS.map(s => s.toUpperCase()));
  }
}

// Sembolü normalize et: BTC-USD → BTC, SP500-USD → SP500
function normalizeSymbol(raw: string): string {
  return raw.replace(/-USD$/i, '').toUpperCase();
}

async function fetchHyperliquidLiqs(hours: number, pacificaSymbols: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  // Pacifica sembollerini normalize et (BTC-USD → BTC formatına çevir)
  const normalizedPac = new Set(Array.from(pacificaSymbols).map(normalizeSymbol));

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
      const hlRaw = String(meta.universe[i]?.name ?? '');
      const ctx   = ctxs[i];
      if (!hlRaw || !ctx) continue;

      // HL sembolünü Pacifica sembolüne çevir
      // Önce mapping'e bak, yoksa bare sembolü dene
      const pacSymbol = HL_TO_PAC[hlRaw] ?? HL_TO_PAC[hlRaw.toUpperCase()] ?? hlRaw.toUpperCase().split('-')[0];

      // Pacifica'da bu sembol var mı kontrol et
      if (!normalizedPac.has(pacSymbol)) continue;

      const openInt   = parseFloat(String(ctx.openInterest ?? '0'));
      const markPrice = parseFloat(String(ctx.markPx ?? '0'));
      const dayVol    = parseFloat(String(ctx.dayNtlVlm ?? '0'));
      if (!markPrice || openInt <= 0 || dayVol < 100) continue;

      const funding  = parseFloat(String(ctx.funding ?? '0'));
      const liqRate  = Math.min(Math.max(Math.abs(funding) * 600 + 0.0015, 0.0015), 0.01);
      const totalLiq = openInt * markPrice * liqRate * Math.min(hours / 24, 1);
      if (totalLiq < 50) continue;

      const longBias = funding > 0 ? 0.65 : 0.35;
      const slices   = Math.max(1, Math.min(hours * 2, 48));
      for (let h = 0; h < slices; h++) {
        const ts    = Date.now() - (h / slices) * hours * 3600 * 1000;
        const slice = totalLiq / slices;
        events.push({ id: `hl-${pacSymbol}-L-${h}`, symbol: pacSymbol, side: 'long',  price: markPrice, notional: slice * longBias,       ts });
        events.push({ id: `hl-${pacSymbol}-S-${h}`, symbol: pacSymbol, side: 'short', price: markPrice, notional: slice * (1 - longBias), ts });
      }
    }
  } catch (e) { console.error('[liq-multi] HL:', e); }
  return events;
}

async function fetchPacificaLiqs(hours: number, pacificaSymbols: Set<string>): Promise<LiqEvent[]> {
  const events: LiqEvent[] = [];
  const cutoff  = Date.now() - hours * 3600 * 1000;
  // Pacifica API'ye sembol-USD formatında gönder
  const symbols = Array.from(pacificaSymbols).slice(0, 70);

  await Promise.all(symbols.map(async (rawSymbol) => {
    // rawSymbol: BTC-USD veya BTC formatında olabilir
    const apiSymbol = rawSymbol.includes('-USD') ? rawSymbol : `${rawSymbol}-USD`;
    const displaySymbol = normalizeSymbol(rawSymbol);
    try {
      const res = await fetch(
        `https://api.pacifica.fi/api/v1/trades?symbol=${apiSymbol}&limit=500`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) return;
      const json = await res.json();
      const trades: { cause?: string; side?: string; price?: string; amount?: string; created_at?: number }[] =
        json?.data ?? [];
      for (const t of trades) {
        if (!t.cause?.toLowerCase().includes('liq')) continue;
        const rawTs = t.created_at ?? 0;
        const ts    = rawTs > 1e12 ? rawTs : rawTs * 1000;
        if (ts < cutoff) continue;
        const price    = parseFloat(t.price ?? '0');
        const notional = price * parseFloat(t.amount ?? '0');
        if (!notional || notional < 10) continue;
        events.push({
          id:     `pac-${displaySymbol}-${ts}`,
          symbol: displaySymbol,
          side:   (t.side ?? '').includes('long') ? 'long' : 'short',
          price, notional, ts,
        });
      }
    } catch { /* ignore */ }
  }));
  return events;
}

function buildSummary(events: LiqEvent[]): LiqSymbolData[] {
  const map = new Map<string, LiqSymbolData>();
  for (const e of events) {
    if (!map.has(e.symbol)) map.set(e.symbol, { symbol: e.symbol, longLiq: 0, shortLiq: 0, total: 0, count: 0 });
    const s = map.get(e.symbol)!;
    if (e.side === 'long') s.longLiq += e.notional; else s.shortLiq += e.notional;
    s.total += e.notional;
    s.count++;
  }
  return Array.from(map.values()).filter(s => s.total > 50).sort((a, b) => b.total - a.total);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours = Math.min(parseInt(searchParams.get('hours') || '24'), 168);
  try {
    const pacificaSymbols = await fetchPacificaSymbols();
    const [hlEvents, pacEvents] = await Promise.all([
      fetchHyperliquidLiqs(hours, pacificaSymbols),
      fetchPacificaLiqs(hours, pacificaSymbols),
    ]);
    const allEvents = [...hlEvents, ...pacEvents];
    const summary   = buildSummary(allEvents);
    const recent    = [...allEvents].sort((a, b) => b.ts - a.ts).slice(0, 300);
    return NextResponse.json({
      summary, recent,
      pacificaSymbols: Array.from(pacificaSymbols),
      meta: {
        fetchedAt:   Date.now(),
        hours,
        totalEvents: allEvents.length,
        sources: { hyperliquid: hlEvents.length, pacifica: pacEvents.length },
      },
    });
  } catch (err) {
    console.error('[liq-multi] fatal:', err);
    return NextResponse.json({ summary: [], recent: [], pacificaSymbols: [],
      meta: { fetchedAt: Date.now(), hours, totalEvents: 0, sources: { hyperliquid: 0, pacifica: 0 } } });
  }
}
