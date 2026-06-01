import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { ItemStatus } from '@/types'
import { SNOOZE_MINUTES_DEFAULT } from '@/lib/constants'

/**
 * Fetches every item for a user once per request and partitions by status.
 * Repo methods below return slices of this single result, so any combination
 * of finders within one request shares the same DB round-trip.
 */
const findAllByUserCached = cache(async (userId: string) =>
  unstable_cache(
    async () => {
      const all = await prisma.item.findMany({
        where: { userId },
        orderBy: [{ status: 'asc' }, { coolingUntil: 'asc' }, { resolvedAt: 'desc' }],
      })
      return {
        all,
        cooling: all
          .filter(i => i.status === 'COOLING')
          .sort((a, b) => a.coolingUntil.getTime() - b.coolingUntil.getTime()),
        skipped: all
          .filter(i => i.status === 'SKIPPED')
          .sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0)),
        bought: all
          .filter(i => i.status === 'BOUGHT')
          .sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0)),
      }
    },
    ['items-findAllByUser', userId],
    { tags: [`items-user-${userId}`] },
  )(),
)

export const itemsRepo = {
  async findManyByUser(userId: string) {
    return (await findAllByUserCached(userId)).all
  },

  /** Aggregate sum — much faster than fetching all rows just to sum. */
  sumSkippedCentsByUser: cache(async (userId: string) =>
    unstable_cache(
      async () => {
        const agg = await prisma.item.aggregate({
          where: { userId, status: 'SKIPPED' },
          _sum: { amountCents: true },
        })
        return agg._sum.amountCents ?? 0
      },
      ['items-sumSkippedCentsByUser', userId],
      { tags: [`items-user-${userId}`] },
    )(),
  ),

  countCoolingByUser: cache(async (userId: string) =>
    unstable_cache(
      async () => prisma.item.count({ where: { userId, status: 'COOLING' } }),
      ['items-countCoolingByUser', userId],
      { tags: [`items-user-${userId}`] },
    )(),
  ),

  countBoughtByUser: cache(async (userId: string) =>
    unstable_cache(
      async () => prisma.item.count({ where: { userId, status: 'BOUGHT' } }),
      ['items-countBoughtByUser', userId],
      { tags: [`items-user-${userId}`] },
    )(),
  ),

  /** Just cooling rows shaped for the bell — small projection. */
  findCoolingForBellByUser: cache(async (userId: string) =>
    unstable_cache(
      async () =>
        prisma.item.findMany({
          where: { userId, status: 'COOLING' },
          orderBy: { coolingUntil: 'asc' },
          select: { id: true, title: true, amountCents: true, coolingUntil: true },
        }),
      ['items-findCoolingForBellByUser', userId],
      { tags: [`items-user-${userId}`] },
    )(),
  ),

  /** Cooling rows shaped for resolve-sheet — adds createdAt for progress bar. */
  findCoolingForResolveByUser: cache(async (userId: string) =>
    unstable_cache(
      async () =>
        prisma.item.findMany({
          where: { userId, status: 'COOLING' },
          orderBy: { coolingUntil: 'asc' },
          select: {
            id: true,
            title: true,
            amountCents: true,
            coolingUntil: true,
            createdAt: true,
            category: true,
          },
        }),
      ['items-findCoolingForResolveByUser', userId],
      { tags: [`items-user-${userId}`] },
    )(),
  ),

  async findSkippedByUser(userId: string) {
    return (await findAllByUserCached(userId)).skipped
  },

  async findBoughtByUser(userId: string) {
    return (await findAllByUserCached(userId)).bought
  },

  async findCoolingByUser(userId: string) {
    return (await findAllByUserCached(userId)).cooling
  },

  async create(data: {
    userId: string
    title: string
    amountCents: number
    coolingUntil: Date
    note?: string
    category?: string
  }) {
    return prisma.item.create({ data })
  },

  async updateResolved(id: string, userId: string, data: { title?: string; amountCents: number; status: 'BOUGHT' | 'SKIPPED'; category?: string }) {
    return prisma.item.update({ where: { id, userId }, data })
  },

  async updateCooling(id: string, userId: string, data: { title: string; amountCents: number; coolingUntil: Date; category?: string }) {
    return prisma.item.update({ where: { id, userId }, data })
  },

  async resolve(id: string, userId: string, status: Extract<ItemStatus, 'BOUGHT' | 'SKIPPED'>) {
    return prisma.item.update({
      where: { id, userId },
      data: { status, resolvedAt: new Date() },
    })
  },

  async searchByUser(userId: string, query: string, limit = 10) {
    const q = query.trim()
    if (!q) return []
    const qLower = q.toLowerCase()

    const pool = await prisma.item.findMany({
      where: {
        userId,
        title: { contains: q, mode: 'insensitive' },
      },
      orderBy: [{ resolvedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit * 4,
    })

    const statusWeight: Record<string, number> = { COOLING: 3, SKIPPED: 2, BOUGHT: 1 }
    const score = (i: (typeof pool)[number]) => {
      const t = i.title.toLowerCase()
      const matchTier = t === qLower ? 100 : t.startsWith(qLower) ? 50 : 10
      return matchTier + (statusWeight[i.status] ?? 0)
    }
    return pool
      .map(i => ({ i, s: score(i) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(x => x.i)
  },

  async snooze(id: string, userId: string, minutes = SNOOZE_MINUTES_DEFAULT) {
    const item = await prisma.item.findUniqueOrThrow({
      where: { id, userId },
      select: { coolingUntil: true },
    })
    const newCoolingUntil = new Date(item.coolingUntil.getTime() + minutes * 60 * 1000)
    return prisma.item.update({
      where: { id, userId },
      data: { coolingUntil: newCoolingUntil },
    })
  },
}
