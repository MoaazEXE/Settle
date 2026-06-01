import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

/**
 * Hard ceiling on the per-group expense rows we materialize. Balance math is
 * still accurate for any realistic group within this window; if a real
 * production group ever bumps against the cap, the activity feed will need
 * proper pagination (incremental fetch) and `computeBalances` will need to
 * shift to a server-side aggregate. Tracked in AUDIT.md.
 */
const GROUP_EXPENSE_PAGE_SIZE = 200

const groupInclude = {
  members: {
    where: { status: 'ACTIVE' as const },
    orderBy: { joinedAt: 'asc' as const },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  },
  guestMembers: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, name: true, addedBy: true, createdAt: true },
  },
  expenses: {
    where: { status: 'COMMITTED' as const },
    orderBy: { createdAt: 'desc' as const },
    take: GROUP_EXPENSE_PAGE_SIZE,
    include: {
      shares: true,
      guestShares: {
        include: { guest: { select: { id: true, name: true, addedBy: true } } },
      },
      payer: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  items: {
    where: { status: 'SKIPPED' as const },
    select: { amountCents: true },
  },
}

const findManyByUserDeepCached = cache(async (userId: string) =>
  unstable_cache(
    async () =>
      prisma.group.findMany({
        where: { members: { some: { userId, status: 'ACTIVE' } } },
        orderBy: { createdAt: 'desc' },
        include: groupInclude,
      }),
    ['groups-findManyByUserDeep', userId],
    { tags: [`groups-user-${userId}`] },
  )(),
)

/** Single group with the same deep shape, gated by ACTIVE membership. */
const findByIdDeepCached = cache(async (id: string, userId: string) =>
  unstable_cache(
    async () => {
      const group = await prisma.group.findUnique({
        where: { id },
        include: groupInclude,
      })
      if (!group) return null
      if (!group.members.some(m => m.userId === userId)) return null
      return group
    },
    ['groups-findByIdDeep', id, userId],
    { tags: [`groups-user-${userId}`, `group-${id}`] },
  )(),
)

/** Pending invites for the current user — used by the bell + /groups banner. */
const findPendingInvitesByUserCached = cache(async (userId: string) =>
  unstable_cache(
    async () =>
      prisma.groupMember.findMany({
        where: { userId, status: 'PENDING' },
        orderBy: { joinedAt: 'desc' },
        include: {
          group: {
            select: {
              id: true,
              name: true,
              _count: { select: { members: { where: { status: 'ACTIVE' } } } },
            },
          },
        },
      }),
    ['groups-findPendingInvitesByUser', userId],
    { tags: [`groups-user-${userId}`] },
  )(),
)

/** Cooling proposals for a group (type=PROPOSAL, status != CANCELLED). */
const findProposalsByGroupCached = cache(async (groupId: string, userId: string) =>
  unstable_cache(
    async () =>
      prisma.expense.findMany({
        where: { groupId, type: 'PROPOSAL', status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        include: {
          payer: { select: { id: true, name: true, avatarUrl: true } },
          shares: {
            include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          },
        },
      }),
    ['groups-findProposalsByGroup', groupId, userId],
    { tags: [`group-${groupId}`, `groups-user-${userId}`] },
  )(),
)

export const groupsRepo = {
  findManyByUserDeep: findManyByUserDeepCached,
  findByIdDeep: findByIdDeepCached,
  findPendingInvitesByUser: findPendingInvitesByUserCached,
  findProposalsByGroup: findProposalsByGroupCached,

  async findRecentGroupExpensesByOthers(userId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return prisma.expense.findMany({
      where: {
        type: 'INSTANT',
        status: 'COMMITTED',
        NOT: { description: { startsWith: 'Settlement' } },
        payerId: { not: userId },
        createdAt: { gte: since },
        group: { members: { some: { userId, status: 'ACTIVE' } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        description: true,
        amountCents: true,
        createdAt: true,
        groupId: true,
        group: { select: { name: true } },
        payer: { select: { name: true } },
      },
    })
  },

  async findProposalsForGroups(groupIds: string[]) {
    if (groupIds.length === 0) return []
    return prisma.expense.findMany({
      where: { groupId: { in: groupIds }, type: 'PROPOSAL', status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        payer: { select: { id: true, name: true } },
        shares: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
    })
  },

  async findManyByUser(userId: string) {
    return findManyByUserDeepCached(userId)
  },

  async findById(id: string, userId: string) {
    return findByIdDeepCached(id, userId)
  },

  async create(data: { name: string; createdBy: string }) {
    return prisma.group.create({
      data: {
        name: data.name,
        createdBy: data.createdBy,
        members: { create: { userId: data.createdBy, status: 'ACTIVE' } },
      },
    })
  },

  async inviteMember(groupId: string, userId: string, invitedBy: string) {
    return prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, status: 'PENDING', invitedBy },
      update: {},
    })
  },

  async acceptInvite(groupId: string, userId: string) {
    return prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { status: 'ACTIVE', joinedAt: new Date() },
    })
  },

  async rejectInvite(groupId: string, userId: string) {
    return prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    })
  },

  countByUser: cache(async (userId: string) =>
    unstable_cache(
      async () => prisma.groupMember.count({ where: { userId, status: 'ACTIVE' } }),
      ['groups-countByUser', userId],
      { tags: [`groups-user-${userId}`] },
    )(),
  ),

  async addGuestMember(groupId: string, name: string, addedBy: string) {
    return prisma.guestMember.create({ data: { groupId, name: name.trim(), addedBy } })
  },

  async removeGuestMember(guestId: string, requestingUserId: string) {
    const guest = await prisma.guestMember.findUnique({
      where: { id: guestId },
      include: { group: { select: { createdBy: true } } },
    })
    if (!guest) return
    const isAdder = guest.addedBy === requestingUserId
    const isOwner = guest.group.createdBy === requestingUserId
    if (!isAdder && !isOwner) {
      throw new Error('Only the person who added this guest, or the group owner, can remove them.')
    }
    await prisma.guestMember.delete({ where: { id: guestId } })
  },

  async searchByUser(userId: string, query: string, limit = 5) {
    const q = query.trim()
    if (!q) return []
    return prisma.group.findMany({
      where: {
        members: { some: { userId, status: 'ACTIVE' } },
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { members: { where: { status: 'ACTIVE' } } } },
      },
    })
  },

  /** Members of any group the user shares — for the search palette. */
  async searchMembersByUser(userId: string, query: string, limit = 5) {
    const q = query.trim()
    if (!q) return []
    return prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } },
          {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
          {
            groupMembers: {
              some: {
                status: 'ACTIVE',
                group: { members: { some: { userId, status: 'ACTIVE' } } },
              },
            },
          },
        ],
      },
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        groupMembers: {
          where: {
            status: 'ACTIVE',
            group: { members: { some: { userId, status: 'ACTIVE' } } },
          },
          select: { group: { select: { id: true, name: true } } },
          take: 1,
        },
      },
    })
  },

  countPendingInvitesByUser: cache(async (userId: string) =>
    unstable_cache(
      async () => prisma.groupMember.count({ where: { userId, status: 'PENDING' } }),
      ['groups-countPendingInvitesByUser', userId],
      { tags: [`groups-user-${userId}`] },
    )(),
  ),

  /** Active group IDs for a user — used to scope the global realtime subscription. */
  async findActiveGroupIdsByUser(userId: string): Promise<string[]> {
    const rows = await prisma.groupMember.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { groupId: true },
    })
    return rows.map(r => r.groupId)
  },

  async requireActiveMembership(groupId: string, userId: string): Promise<void> {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    })
    if (!member || member.status !== 'ACTIVE') {
      throw new Error("You're not a member of this group.")
    }
  },
} as const

export type GroupsRepo = typeof groupsRepo
export type DeepGroup = Awaited<ReturnType<typeof findManyByUserDeepCached>>[number]
