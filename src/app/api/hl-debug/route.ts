import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol') || 'SP500';
  
  try {
    // Pacifica trade endpoint'ini test et
    const res = await fetch(
      `https://api.pacifica.fi/api/v1/trades?symbol=${symbol}-USD&limit=100`,
      { signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    const trades = json?.data ?? [];
    
    // Tüm cause değerlerini göster
    const causes = [...new Set(trades.map((t: {cause?:string}) => t.cause))];
    const liqTrades = trades.filter((t: {cause?:string}) => 
      t.cause?.toLowerCase().includes('liq')
    );
    
    return NextResponse.json({
      symbol,
      totalTrades: trades.length,
      causes,
      liqTradeCount: liqTrades.length,
      sample: trades.slice(0,3),
    });
  } catch(e) {
    return NextResponse.json({error: String(e)});
  }
}
