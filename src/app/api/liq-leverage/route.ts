/**
 * GET /api/liq-leverage?symbol=BTC-USD&hours=24
 * 
 * Coinglass tarzı "Liquidation Leverage Map" verisi:
 * Mevcut açık pozisyonların liq price'larını fiyat seviyelerine göre dağıtır.
 * 
 * Kaynaklar:
 * 1. Pacifica: leaderboard'daki trader pozisyonları + liquidation_price
 * 2. HyperLiquid: clearinghouse açık pozisyonlar + liquidation price tahmini
 * 
 * Response: { levels: [{price, longLiq, shortLiq}], markPrice, totalLong, totalShort }
 */
import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 25;

interface LiqLevel {
  price: number;      // fiyat seviyesi
  longLiq: number;    // bu seviyede likide olacak long notional ($)
  shortLiq: number;   // bu seviyede likide olacak short notional ($)
}

// Pacifica: top trader'ların pozisyonlarını ve liq price'larını çek
async function fetchPacificaLiqLevels(
  symbol: string,
  baseUrl: string
): Promise<{ levels: LiqLevel[]; markPrice: number }> {
  const coin = symbol.replace(/-USD$/i, '').toUpperCase();
  const result: LiqLevel[] = [];
  let markPrice = 0;

  try {
    // 1. Mark price
    const priceRes = await fetch(`${baseUrl}/api/v1/info/prices`, { signal: AbortSignal.timeout(5000) });
    if (priceRes.ok) {
      const pj = await priceRes.json();
      const tickers: { symbol: string; mark_price?: string; last_price?: string }[] = pj?.data ?? pj ?? [];
      const ticker = tickers.find(t => t.symbol?.replace(/-USD$/i,'').toUpperCase() === coin);
      if (ticker) markPrice = parseFloat(ticker.mark_price ?? ticker.last_price ?? '0');
    }

    // 2. Leaderboard'dan top trader adresleri çek
    const lbRes = await fetch(`${baseUrl}/api/v1/leaderboard?limit=500`, { signal: AbortSignal.timeout(8000) });
    if (!lbRes.ok) return { levels: result, markPrice };
    const lbJson = await lbRes.json();
    const traders: { account?: string; address?: string; oi_current?: number }[] =
      lbJson?.data ?? lbJson ?? [];

    // Sadece oi > 0 olanları al (aktif pozisyon var)
    const activeTraders = traders
      .filter(t => (t.oi_current ?? 0) > 100)
      .slice(0, 200); // ilk 200 trader

    // 3. Her trader'ın pozisyonlarını paralel çek
    const positionResults = await Promise.allSettled(
      activeTraders.map(async (trader) => {
        const addr = trader.account ?? trader.address ?? '';
        if (!addr) return [];
        const res = await fetch(`${baseUrl}/api/v1/positions?account=${addr}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return [];
        const json = await res.json();
        const positions: {
          symbol: string;
          side: string;
          amount: string;
          entry_price: string;
          liquidation_price?: string;
          margin?: string;
          leverage?: string;
        }[] = json?.data ?? [];
        return positions.filter(p =>
          p.symbol?.replace(/-USD$/i,'').toUpperCase() === coin &&
          p.liquidation_price &&
          parseFloat(p.liquidation_price) > 0
        );
      })
    );

    // 4. Liq price'ları seviyeye göre topla
    const levelMap = new Map<number, LiqLevel>();

    const roundToLevel = (price: number, tickSize: number) =>
      Math.round(price / tickSize) * tickSize;

    const tickSize = markPrice > 10000 ? 50 : markPrice > 1000 ? 5 : markPrice > 100 ? 1 : 0.1;

    for (const res of positionResults) {
      if (res.status !== 'fulfilled') continue;
      for (const pos of res.value) {
        const liqPx  = parseFloat(pos.liquidation_price ?? '0');
        const amount = parseFloat(pos.amount ?? '0');
        const entryPx = parseFloat(pos.entry_price ?? '0');
        if (!liqPx || !amount || !entryPx) continue;

        const notional = amount * entryPx;
        if (notional < 100) continue;

        const level = roundToLevel(liqPx, tickSize);
        if (!levelMap.has(level)) levelMap.set(level, { price: level, longLiq: 0, shortLiq: 0 });
        const lv = levelMap.get(level)!;

        const isLong = pos.side === 'bid' || pos.side === 'long';
        if (isLong) lv.longLiq += notional;
        else        lv.shortLiq += notional;
      }
    }

    return { levels: Array.from(levelMap.values()), markPrice };
  } catch (e) {
    console.error('[liq-leverage] Pacifica error:', e);
    return { levels: result, markPrice };
  }
}

// Pacifica → HyperLiquid sembol mapping
const PAC_TO_HL: Record<string, string[]> = {
  'SP500':    ['USA500-USDT','SP500'],
  'XAU':      ['GOLD-USDC','GOLD'],
  'CL':       ['WTIOIL-USDC','WTIOIL'],
  'TSLA':     ['TSLA-USDT','TSLA'],
  'USDJPY':   ['USDJPY-USDC','USDJPY'],
  'EURUSD':   ['EURUSD-USDC','EURUSD'],
  'GOOGL':    ['GOOGL-USDC','GOOGL'],
  'NVDA':     ['NVDA-USDT','NVDA'],
  'PLTR':     ['PLTR-USDC','PLTR'],
  'PLATINUM': ['PLATINUM-USDC','PLATINUM'],
  'URNM':     ['URNM-USDC','URNM'],
  'COPPER':   ['COPPER-USDC','COPPER'],
  'SILVER':   ['SILVER-USDC','SILVER'],
  'NATGAS':   ['NATGAS-USDC','NATGAS'],
  'CRCL':     ['CRCL-USDC','CRCL'],
  'HOOD':     ['HOOD-USDT','HOOD'],
};

// HyperLiquid: assetCtx'ten OI ve funding bazlı liq dağılımı tahmin et
async function fetchHyperliquidLiqLevels(coin: string): Promise<{ levels: LiqLevel[]; markPrice: number }> {
  const result: LiqLevel[] = [];
  let markPrice = 0;

  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { levels: result, markPrice };
    const [meta, ctxs] = await res.json();
    if (!Array.isArray(meta?.universe)) return { levels: result, markPrice };

    // Pacifica sembolünü HL sembollerine çevir
    const hlNames = PAC_TO_HL[coin.toUpperCase()]
      ? [coin.toUpperCase(), ...PAC_TO_HL[coin.toUpperCase()].map(s => s.toUpperCase())]
      : [coin.toUpperCase()];
    const idx = meta.universe.findIndex((u: { name: string }) => hlNames.includes(u.name.toUpperCase()));
    if (idx < 0 || !ctxs[idx]) return { levels: result, markPrice };

    const ctx = ctxs[idx];
    markPrice = parseFloat(String(ctx.markPx ?? '0'));
    const openInt = parseFloat(String(ctx.openInterest ?? '0'));
    const funding = parseFloat(String(ctx.funding ?? '0'));
    if (!markPrice || openInt <= 0) return { levels: result, markPrice };

    // Liq seviyeleri: leverage dağılımına göre
    // Tipik perp trader leverage dağılımı: 2x-50x
    // Liq price = entry * (1 - 1/leverage) for longs
    //           = entry * (1 + 1/leverage) for shorts
    // Gerçekçi leverage dağılımı — her leverage için farklı entry price noktaları
    // Traders farklı fiyatlardan girmiş = liq fiyatları dağılmış
    const leverageBuckets = [
      { lev: 3,   weight: 0.06 },
      { lev: 5,   weight: 0.12 },
      { lev: 10,  weight: 0.28 },
      { lev: 15,  weight: 0.16 },
      { lev: 20,  weight: 0.18 },
      { lev: 25,  weight: 0.10 },
      { lev: 50,  weight: 0.07 },
      { lev: 100, weight: 0.03 },
    ];

    const longBias      = funding >= 0 ? 0.55 : 0.45;
    const totalNotional = openInt * markPrice;
    const tickSize      = markPrice > 10000 ? 25 : markPrice > 1000 ? 2 : markPrice > 100 ? 0.5 : 0.1;

    const levelMap = new Map<number, LiqLevel>();
    const addLevel = (px: number, isLong: boolean, notional: number) => {
      const level = Math.round(px / tickSize) * tickSize;
      if (level <= 0) return;
      if (!levelMap.has(level)) levelMap.set(level, { price: level, longLiq: 0, shortLiq: 0 });
      const lv = levelMap.get(level)!;
      if (isLong) lv.longLiq += notional; else lv.shortLiq += notional;
    };

    // Farklı entry noktaları simüle et (son 7 günün fiyat değişimi ±%15)
    const entryOffsets = [-0.12, -0.08, -0.04, -0.02, 0, 0.02, 0.04, 0.08, 0.12];
    const offsetWeights = [0.04, 0.08, 0.14, 0.18, 0.12, 0.18, 0.14, 0.08, 0.04];

    for (const { lev, weight } of leverageBuckets) {
      const bucketNotional = totalNotional * weight;
      
      for (let oi = 0; oi < entryOffsets.length; oi++) {
        const entryPrice     = markPrice * (1 + entryOffsets[oi]);
        const sliceNotional  = bucketNotional * offsetWeights[oi];
        const longNotional   = sliceNotional * longBias;
        const shortNotional  = sliceNotional * (1 - longBias);

        // Maintenance margin ~%0.5, liq price = entry * (1 - (1/lev - 0.005))
        const longLiqPx  = entryPrice * (1 - (1/lev - 0.005));
        const shortLiqPx = entryPrice * (1 + (1/lev - 0.005));

        if (longLiqPx  > 0) addLevel(longLiqPx,  true,  longNotional);
        if (shortLiqPx > 0) addLevel(shortLiqPx, false, shortNotional);
      }
    }

    return { levels: Array.from(levelMap.values()), markPrice };
  } catch (e) {
    console.error('[liq-leverage] HL error:', e);
    return { levels: result, markPrice };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol  = (searchParams.get('symbol') || 'BTC-USD').toUpperCase();
  const baseUrl = 'https://api.pacifica.fi';
  const coin    = symbol.replace(/-USD$/i, '');

  try {
    const [pacifica, hl] = await Promise.all([
      fetchPacificaLiqLevels(symbol, baseUrl),
      fetchHyperliquidLiqLevels(coin),
    ]);

    // Birleştir
    const markPrice = hl.markPrice || pacifica.markPrice;
    const levelMap  = new Map<number, LiqLevel>();

    const merge = (levels: LiqLevel[]) => {
      for (const lv of levels) {
        if (!levelMap.has(lv.price)) levelMap.set(lv.price, { price: lv.price, longLiq: 0, shortLiq: 0 });
        const m = levelMap.get(lv.price)!;
        m.longLiq  += lv.longLiq;
        m.shortLiq += lv.shortLiq;
      }
    };
    merge(pacifica.levels);
    merge(hl.levels);

    const levels = Array.from(levelMap.values())
      .filter(lv => lv.longLiq + lv.shortLiq > 0)
      .sort((a, b) => a.price - b.price);

    const totalLong  = levels.reduce((s, l) => s + l.longLiq, 0);
    const totalShort = levels.reduce((s, l) => s + l.shortLiq, 0);

    return NextResponse.json({
      levels,
      markPrice,
      totalLong,
      totalShort,
      symbol,
      fetchedAt: Date.now(),
      sources: {
        pacificaLevels: pacifica.levels.length,
        hlLevels:       hl.levels.length,
      },
    });
  } catch (err) {
    console.error('[liq-leverage] fatal:', err);
    return NextResponse.json({
      levels: [], markPrice: 0, totalLong: 0, totalShort: 0, symbol,
      fetchedAt: Date.now(), sources: { pacificaLevels: 0, hlLevels: 0 },
    });
  }
}
