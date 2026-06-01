import { parseAmountToCents } from '@/lib/money'
import { MAX_AMOUNT_CENTS } from '@/lib/constants'

/**
 * Tiny typed FormData accessors. Keeps Server Actions honest without
 * pulling in a full schema lib for a 1-day project.
 */

export function getString(fd: FormData, key: string): string | null {
  const v = fd.get(key)
  return typeof v === 'string' ? v : null
}

export function getRequiredString(fd: FormData, key: string): string {
  const v = getString(fd, key)?.trim()
  if (!v) throw new ValidationError(`${key} is required.`)
  return v
}

export function getOptionalNumber(fd: FormData, key: string): number | null {
  const raw = getString(fd, key)
  if (raw == null || raw === '') return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

export function getCents(fd: FormData, key: string): number | null {
  const raw = getString(fd, key)
  if (raw == null || raw === '') return null
  return parseAmountToCents(raw)
}

export function getRequiredCents(fd: FormData, key: string): number {
  const c = getCents(fd, key)
  if (c == null || c <= 0) throw new ValidationError('Enter a valid amount.')
  if (c > MAX_AMOUNT_CENTS) throw new ValidationError('Amount is too large (max RM 1,000,000).')
  return c
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/** Wrap a Server Action body so ValidationErrors return as form messages. */
export async function withValidation<T>(fn: () => Promise<T>, scope?: string): Promise<T | string> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ValidationError) return e.message
    // Log unexpected infra failures before re-throwing to the error boundary
    if (scope) {
      const { logError } = await import('@/lib/log-error')
      await logError(scope, {}, e)
    }
    throw e
  }
}
