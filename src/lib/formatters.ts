import { DEFAULT_CURRENCY } from '@/lib/constants'

export const CURRENCIES = [
  { code: 'MYR', symbol: 'RM',  label: 'Malaysian Ringgit', locale: 'en-MY' },
  { code: 'USD', symbol: '$',   label: 'US Dollar',          locale: 'en-US' },
  { code: 'EUR', symbol: '€',   label: 'Euro',               locale: 'de-DE' },
  { code: 'SAR', symbol: '﷼',  label: 'Saudi Riyal',        locale: 'ar-SA' },
  { code: 'GBP', symbol: '£',   label: 'British Pound',      locale: 'en-GB' },
  { code: 'SGD', symbol: 'S$',  label: 'Singapore Dollar',   locale: 'en-SG' },
] as const

export type CurrencyCode = (typeof CURRENCIES)[number]['code']

function currencyMeta(code: string) {
  return CURRENCIES.find(c => c.code === code) ?? CURRENCIES[0]
}

/**
 * Format cents with a specific currency.
 *   decimals=2  → always 2 decimal places (use for totals/inputs)
 *   decimals=0  → up to 2 decimals, trailing zeros trimmed
 *                 (4.50 → "4.5", 4.00 → "4", 4.75 → "4.75")
 *                 Use for list rows — keeps things compact but never rounds
 *                 cents away from the user's eyes.
 */
export function fmtCurrency(cents: number, currency: string, decimals: 0 | 2 = 2): string {
  const meta = currencyMeta(currency)
  const amount = new Intl.NumberFormat(meta.locale, {
    minimumFractionDigits: decimals === 2 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100)
  return `${meta.symbol} ${amount}`
}

/** Format cents as Malaysian Ringgit (default currency). decimals=2 for totals, 0 for list rows. */
export function fmtRM(cents: number, decimals: 0 | 2 = 2): string {
  return fmtCurrency(cents, DEFAULT_CURRENCY, decimals)
}

/** Human-readable countdown from milliseconds remaining. */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'Ready'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s left`
  return `${s}s left`
}

/** Parse a stored cooling period string like "1d" into value + unit. */
export function parseCoolingPeriod(s: string): { value: number; unit: 'HOURS' | 'DAYS' | 'WEEKS' } {
  const match = s.match(/^(\d+)([hdw])$/)
  if (!match) return { value: 1, unit: 'DAYS' }
  const value = parseInt(match[1], 10)
  const unit = match[2] === 'h' ? 'HOURS' : match[2] === 'd' ? 'DAYS' : 'WEEKS'
  return { value, unit }
}
