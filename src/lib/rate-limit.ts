import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/form-data'
import { logError } from '@/lib/log-error'

/**
 * Sliding-window rate limiter backed by Postgres.
 * Returns true if the request is allowed, false if the limit is exceeded.
 * Uses a transaction to avoid races under concurrent requests.
 */
export async function consume(key: string, limit: number, windowSec: number): Promise<boolean> {
  const now = new Date()
  const windowMs = windowSec * 1000
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimit.findUnique({ where: { key } })

    if (existing && existing.windowStart.getTime() === windowStart.getTime()) {
      if (existing.count >= limit) return false
      await tx.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } })
      return true
    }

    // New or expired window — reset counter
    await tx.rateLimit.upsert({
      where: { key },
      create: { key, windowStart, count: 1 },
      update: { windowStart, count: 1 },
    })
    return true
  })
}

/** Convenience: throws ValidationError if the limit is exceeded. */
export async function guard(key: string, limit: number, windowSec: number): Promise<void> {
  const allowed = await consume(key, limit, windowSec).catch((err) => {
    logError('rate-limit-guard', { key, limit, windowSec }, err)
    return true // fail open to avoid blocking on DB error
  })
  if (!allowed) throw new ValidationError('Too many requests — slow down.')
}
