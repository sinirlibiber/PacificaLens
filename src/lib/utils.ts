import { Ticker } from './pacifica';

export function fmt(n: number | string | null | undefined, dec = 2): string {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtPrice(n: number | string | null | undefined): string {
  if (!n) return '—';
  const v = Number(n);
  if (isNaN(v) || v === 0) return '—';
  if (v >= 10000) return fmt(v, 2);
  if (v >= 1000) return fmt(v, 2);
  if (v >= 1) return fmt(v, 4);
  return fmt(v, 6);
}

export function fmtShortAddr(addr: string): string {
  if (!addr || addr.length < 8) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function getMarkPrice(ticker: Ticker | undefined): number {
  if (!ticker) return 0;
  return Number(ticker.mark || ticker.oracle || ticker.mid || 0);
}

export function get24hChange(ticker: Ticker | undefined): number {
  if (!ticker) return 0;
  const mark = Number(ticker.mark || ticker.oracle || 0);
  const yesterday = Number(ticker.yesterday_price || 0);
  // yesterday_price 0 veya eksikse N/A yerine 0 döndür
  if (!yesterday || !mark || yesterday === 0) return 0;
  return ((mark - yesterday) / yesterday) * 100;
}

// Pacifica token logo URL - önce Pacifica SVG dene, bulamazsa CoinCap
const PACIFICA_TOKENS = new Set([
  'CRCL','PLATINUM','SP500','2Z','XPL','GOOGL','ASTER','URNM','WLFI',
  'BP','HOOD','FARTCOIN','MON','USDJPY','EURUSD','NVDA','COPPER',
  'NATGAS','PLTR','CL','XAG','XAU',
  // kPrefixed - base symbol
  'kBONK','kPEPE','kSHIB','kFLOKI','kLUNC','kNEIRO','kDOGS',
]);

const K_OVERRIDES: Record<string, string> = {
  kBONK: 'BONK', kPEPE: 'PEPE', kSHIB: 'SHIB',
  kFLOKI: 'FLOKI', kLUNC: 'LUNC', kNEIRO: 'NEIRO', kDOGS: 'DOGS',
};

export function getPacificaLogoUrl(symbol: string): string {
  // kXXX tokens - use base symbol on Pacifica
  const base = K_OVERRIDES[symbol] || symbol;
  return `https://app.pacifica.fi/imgs/tokens/${base}.svg`;
}

export function getCoinCapLogoUrl(symbol: string): string {
  const base = K_OVERRIDES[symbol] || symbol.replace(/^k/, '');
  return `https://assets.coincap.io/assets/icons/${base.toLowerCase()}@2x.png`;
}

export function hasPacificaLogo(symbol: string): boolean {
  const base = K_OVERRIDES[symbol] || symbol;
  // Pacifica has logos for these known tokens
  return PACIFICA_TOKENS.has(base) || PACIFICA_TOKENS.has(symbol);
}
