/**
 * Application-wide constants — single source of truth for magic values.
 * Import from here rather than repeating inline literals across the codebase.
 */

/** ISO 4217 currency code used when the user has not configured a preference. */
export const DEFAULT_CURRENCY = 'MYR' as const

/** Cooling-period string applied when the user has no saved preference. */
export const DEFAULT_COOLING_PERIOD = '1d' as const

/**
 * Users created on or after this date must complete onboarding before
 * accessing the app. Users created before are grandfathered in.
 */
export const ONBOARDING_REQUIRED_FROM = new Date('2026-05-27T00:00:00Z')

/** Default snooze duration in minutes (24 hours). */
export const SNOOZE_MINUTES_DEFAULT = 1440

/** Maximum number of rows returned by the CSV export per section. */
export const CSV_EXPORT_LIMIT = 10_000

/** Maximum allowed item amount in cents (= RM 1,000,000). */
export const MAX_AMOUNT_CENTS = 100_000_000
