import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // investing.com economic calendar via allorigins proxy
    const url = 'https://sslecal2.investing.com/pp.php?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&category=_centralBanks,_interestRates,_inflation,_employment,_gdp&limit=30&action=filter&lang_ID=1&timeZone=8&timezoneInput=UTC&timeFilter=timeOnly&currentTab=thisWeek&submit=/';
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('Calendar fetch failed');
    const data = await res.json();
    // allorigins wraps in { contents: "..." }
    const parsed = JSON.parse(data.contents);
    return NextResponse.json(parsed);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
