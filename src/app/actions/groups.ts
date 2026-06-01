'use server'

import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/supabase/server'
import { ensureUserRecord } from '@/lib/ensure-user'
import { groupsRepo } from '@/data/groups.repo'
import { expensesRepo } from '@/data/expenses.repo'
import { equalSplit, settlementPlan, guestIdFromNode } from '@/core/debt/groupBalances'
import {
  getRequiredString,
  getRequiredCents,
  ValidationError,
  withValidation,
} from '@/lib/form-data'
import { guard } from '@/lib/rate-limit'
import { normalizeUsername } from '@/lib/username'
import { usersRepo } from '@/data/users.repo'

async function getAuthUserId(): Promise<string> {
  const user = await getCurrentUser()
  if (!user) throw new ValidationError('Unauthorized')
  await ensureUserRecord(user)
  return user.id
}

async function requireActiveMembership(groupId: string, userId: string): Promise<void> {
  await groupsRepo.requireActiveMembership(groupId, userId).catch(() => {
    throw new ValidationError("You're not a member of this group.")
  })
}

/**
 * Invalidates cached data for every active member of a group plus the group's
 * own tag. Call this after any mutation that changes group content so all
 * members (including non-acting ones whose realtime refresh fires) get fresh data.
 */
async function revalidateGroupMembers(groupId: string, extraUserId?: string) {
  const members = await prisma.groupMember.findMany({
    where: { groupId, status: 'ACTIVE' },
    select: { userId: true },
  })
  for (const { userId } of members) {
    updateTag(`groups-user-${userId}`)
  }
  // Cover the acting user if they're no longer an active member (e.g. after leave/reject)
  if (extraUserId && !members.some(m => m.userId === extraUserId)) {
    updateTag(`groups-user-${extraUserId}`)
  }
  updateTag(`group-${groupId}`)
}

/**
 * Returns either an error string OR a JSON-encoded payload `{"id":"..."}`
 * with the new group's id. Client picks the right destination per viewport.
 */
export async function createGroup(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let userId: string | null = null
  let newId: string | null = null
  const result = await withValidation(async () => {
    const name = getRequiredString(formData, 'name')
    if (name.length > 60) throw new ValidationError('Group name is too long.')
    userId = await getAuthUserId()
    await guard(`createGroup:${userId}`, 10, 3600)
    const group = await groupsRepo.create({ name, createdBy: userId })
    newId = group.id
  }, 'action:createGroup')

  if (typeof result === 'string') return result
  if (userId) updateTag(`groups-user-${userId}`)
  if (newId) return JSON.stringify({ id: newId })
  return null
}

export async function inviteMember(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let inviteeId: string | null = null
  let actingUserId: string | null = null
  const result = await withValidation(async () => {
    const groupId = getRequiredString(formData, 'groupId')
    const identifier = getRequiredString(formData, 'identifier').trim()
    actingUserId = await getAuthUserId()
    await guard(`invite:${actingUserId}`, 10, 60)
    await requireActiveMembership(groupId, actingUserId)

    // Support @username or email lookup
    let invitee: { id: string } | null = null
    if (identifier.startsWith('@')) {
      const usernameLower = normalizeUsername(identifier.slice(1))
      invitee = await usersRepo.findByUsername(usernameLower)
      if (!invitee) {
        throw new ValidationError(
          "We can't find anyone with that username. Ask them to sign up first.",
        )
      }
    } else {
      const email = identifier.toLowerCase()
      invitee = await prisma.user.findUnique({ where: { email } })
      if (!invitee) {
        throw new ValidationError(
          "We can't find anyone with that email. Ask them to sign up first.",
        )
      }
    }

    if (invitee.id === actingUserId) {
      throw new ValidationError("You're already in this group.")
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: invitee.id } },
    })
    if (existing?.status === 'ACTIVE') {
      throw new ValidationError("They're already in this group.")
    }
    if (existing?.status === 'PENDING') {
      throw new ValidationError("They already have a pending invite.")
    }

    inviteeId = invitee.id
    await groupsRepo.inviteMember(groupId, invitee.id, actingUserId)
  })

  if (typeof result === 'string') return result
  const groupId = formData.get('groupId') as string
  // Invitee sees the new pending invite; existing members see updated member count
  if (inviteeId) updateTag(`groups-user-${inviteeId}`)
  updateTag(`group-${groupId}`)
  return null
}

export async function acceptInvite(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const userId = await getAuthUserId()
  const invite = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  })
  if (!invite || invite.status !== 'PENDING') {
    throw new ValidationError('No pending invite for this group.')
  }
  await groupsRepo.acceptInvite(groupId, userId)
  // Revalidate all members (new member joins — everyone's group data changes)
  await revalidateGroupMembers(groupId, userId)
}

export async function transferOwnership(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const newOwnerId = getRequiredString(formData, 'newOwnerId')
  const userId = await getAuthUserId()

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: { where: { status: 'ACTIVE' }, select: { userId: true } } },
  })
  if (!group) throw new ValidationError('Group not found.')
  if (group.createdBy !== userId) {
    throw new ValidationError('Only the creator can transfer ownership.')
  }
  if (newOwnerId === userId) {
    throw new ValidationError("You're already the owner.")
  }
  if (!group.members.some(m => m.userId === newOwnerId)) {
    throw new ValidationError('Pick an active member of this group.')
  }

  await prisma.group.update({
    where: { id: groupId },
    data: { createdBy: newOwnerId },
  })

  await revalidateGroupMembers(groupId)
}

export async function kickMember(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const memberId = getRequiredString(formData, 'memberId')
  const userId = await getAuthUserId()

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { createdBy: true },
  })
  if (!group) throw new ValidationError('Group not found.')
  if (group.createdBy !== userId) throw new ValidationError('Only the owner can remove members.')
  if (memberId === userId) throw new ValidationError('You cannot remove yourself.')
  if (memberId === group.createdBy) throw new ValidationError('Cannot remove the group owner.')

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: memberId } },
  })
  if (!member || member.status !== 'ACTIVE') throw new ValidationError('Member not found.')

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId, userId: memberId } },
  })

  updateTag(`groups-user-${memberId}`)
  await revalidateGroupMembers(groupId, memberId)
}

export async function leaveGroup(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const userId = await getAuthUserId()
  await requireActiveMembership(groupId, userId)

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { createdBy: true },
  })
  if (!group) throw new ValidationError('Group not found.')
  if (group.createdBy === userId) {
    throw new ValidationError(
      "You're the creator — delete the group instead, or transfer it first.",
    )
  }

  // Capture remaining members before removal so we can revalidate them
  const remainingMembers = await prisma.groupMember.findMany({
    where: { groupId, status: 'ACTIVE', NOT: { userId } },
    select: { userId: true },
  })

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId, userId } },
  })

  // Revalidate leaving user + remaining members
  updateTag(`groups-user-${userId}`)
  for (const { userId: memberId } of remainingMembers) {
    updateTag(`groups-user-${memberId}`)
  }
  updateTag(`group-${groupId}`)
  redirect('/groups')
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const userId = await getAuthUserId()
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { createdBy: true },
  })
  if (!group) throw new ValidationError('Group not found.')
  if (group.createdBy !== userId) {
    throw new ValidationError('Only the creator can delete a group.')
  }

  // Capture all members before the cascade delete removes them
  const members = await prisma.groupMember.findMany({
    where: { groupId, status: 'ACTIVE' },
    select: { userId: true },
  })

  // Cascades drop members, expenses, shares. Items lose their groupId
  // (onDelete: SetNull) so personal cooling history survives.
  await prisma.group.delete({ where: { id: groupId } })

  for (const { userId: memberId } of members) {
    updateTag(`groups-user-${memberId}`)
  }
  updateTag(`group-${groupId}`)
  redirect('/groups')
}

export async function rejectInvite(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const userId = await getAuthUserId()
  const invite = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  })
  if (!invite || invite.status !== 'PENDING') return
  await groupsRepo.rejectInvite(groupId, userId)
  updateTag(`groups-user-${userId}`)
}

function parseParticipants(formData: FormData): string[] {
  const all = formData.getAll('participants')
  return all
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .filter((v, i, arr) => arr.indexOf(v) === i)
}

function parseGuestParticipants(formData: FormData): string[] {
  const all = formData.getAll('guestParticipants')
  return all
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .filter((v, i, arr) => arr.indexOf(v) === i)
}

export async function addGuestMember(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let userId: string | null = null
  const result = await withValidation(async () => {
    const groupId = getRequiredString(formData, 'groupId')
    const name = getRequiredString(formData, 'guestName')
    if (name.length > 60) throw new ValidationError('Name is too long.')
    userId = await getAuthUserId()
    await requireActiveMembership(groupId, userId)
    await groupsRepo.addGuestMember(groupId, name, userId)
    await revalidateGroupMembers(groupId)
  }, 'action:addGuestMember')
  return typeof result === 'string' ? result : null
}

export async function removeGuestMember(formData: FormData): Promise<void> {
  const guestId = getRequiredString(formData, 'guestId')
  const userId = await getAuthUserId()
  // Look up the group first so we can revalidate even after the delete
  // and surface the authorization error from the repo as a ValidationError
  // (clients catch and toast that — silently swallowing was masking real "you
  // can't remove this guest" responses).
  const target = await prisma.guestMember.findUnique({
    where: { id: guestId },
    select: { groupId: true },
  })
  try {
    await groupsRepo.removeGuestMember(guestId, userId)
  } catch (e) {
    if (e instanceof Error) throw new ValidationError(e.message)
    throw e
  }
  if (target) await revalidateGroupMembers(target.groupId)
}

export async function addExpense(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let groupId: string | null = null
  const result = await withValidation(async () => {
    groupId = getRequiredString(formData, 'groupId')
    const description = getRequiredString(formData, 'description')
    const amountCents = getRequiredCents(formData, 'amount')
    const userId = await getAuthUserId()
    await guard(`addExpense:${userId}`, 60, 60)
    await requireActiveMembership(groupId, userId)

    const rawPayerId = formData.get('payerId') as string | null
    const rawGuestPayerId = formData.get('guestPayerId') as string | null

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: { where: { status: 'ACTIVE' }, select: { userId: true } },
        guestMembers: { select: { id: true, addedBy: true } },
      },
    })
    if (!group) throw new ValidationError('Group not found.')

    const activeIds = new Set(group.members.map(m => m.userId))
    const guestIds = new Set(group.guestMembers.map(g => g.id))

    let payerId: string
    if (rawGuestPayerId && rawGuestPayerId.trim()) {
      if (!guestIds.has(rawGuestPayerId)) throw new ValidationError('Selected guest payer is not in this group.')
      const guest = group.guestMembers.find(g => g.id === rawGuestPayerId)
      if (!guest) throw new ValidationError('Guest not found.')
      payerId = guest.addedBy
    } else {
      payerId = rawPayerId && rawPayerId.trim() ? rawPayerId : userId
      if (!activeIds.has(payerId)) throw new ValidationError('Selected payer is not an active group member.')
    }

    const requested = parseParticipants(formData)
    const requestedGuests = parseGuestParticipants(formData)
    // Default to "everyone" (members + guests) when the user submitted no
    // selections at all. If they explicitly picked some, respect that — don't
    // silently fan out to anyone they unchecked.
    const noSelections = requested.length === 0 && requestedGuests.length === 0
    const participants = noSelections ? Array.from(activeIds) : requested
    const effectiveGuests = noSelections ? Array.from(guestIds) : requestedGuests

    for (const id of participants) {
      if (!activeIds.has(id)) throw new ValidationError('One of the selected people is not a group member.')
    }
    for (const id of effectiveGuests) {
      if (!guestIds.has(id)) throw new ValidationError('One of the selected guests is not in this group.')
    }
    if (participants.length === 0 && effectiveGuests.length === 0) {
      throw new ValidationError('Pick at least one person to split this with.')
    }

    // Equal split across members + guests; remainder goes to the payer if they're
    // a participant, otherwise to the first share so totals reconcile.
    const totalPeople = participants.length + effectiveGuests.length
    const base = Math.floor(amountCents / totalPeople)
    const remainder = amountCents - base * totalPeople
    const payerIsParticipant = participants.includes(payerId)
    const shares = participants.map((uid, i) => ({
      userId: uid,
      shareCents:
        (payerIsParticipant ? uid === payerId : i === 0)
          ? base + remainder
          : base,
    }))
    const guestShares = effectiveGuests.map((gid, i) => ({
      guestId: gid,
      shareCents: !payerIsParticipant && participants.length === 0 && i === 0 ? base + remainder : base,
    }))

    await prisma.expense.create({
      data: {
        groupId,
        payerId: payerId,
        amountCents,
        description,
        type: 'INSTANT',
        status: 'COMMITTED',
        shares: { create: shares },
        guestShares: { create: guestShares },
      },
    })
  })

  if (typeof result === 'string') return result
  if (groupId) await revalidateGroupMembers(groupId)
  return null
}

async function requireExpenseAccess(expenseId: string, userId: string) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      group: {
        include: {
          members: {
            where: { status: 'ACTIVE' },
            select: { userId: true },
          },
        },
      },
    },
  })
  if (!expense) throw new ValidationError('Activity not found.')
  if (!expense.group.members.some(m => m.userId === userId)) {
    throw new ValidationError("You're not a member of this group.")
  }
  return expense
}

/**
 * Stricter check for mutating operations on an expense — the actor must be
 * the original payer (or the group's creator, as a moderation backstop).
 * Use this for edit/delete/resplit of a single expense. Read access for
 * group members is granted by `requireExpenseAccess` instead.
 */
async function requireExpenseMutator(expenseId: string, userId: string) {
  const expense = await requireExpenseAccess(expenseId, userId)
  const isPayer = expense.payerId === userId
  const isOwner = await prisma.group
    .findUnique({ where: { id: expense.groupId }, select: { createdBy: true } })
    .then(g => g?.createdBy === userId)
  if (!isPayer && !isOwner) {
    throw new ValidationError('Only the payer or the group owner can change this activity.')
  }
  return expense
}

export async function editExpense(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let groupIdForRevalidate: string | null = null
  const result = await withValidation(async () => {
    const expenseId = getRequiredString(formData, 'expenseId')
    const description = getRequiredString(formData, 'description')
    const amountCents = getRequiredCents(formData, 'amount')
    const resplit = formData.get('resplit') === '1'

    const userId = await getAuthUserId()
    const expense = await requireExpenseMutator(expenseId, userId)
    groupIdForRevalidate = expense.groupId

    if (resplit) {
      const customMemberIds = formData.getAll('resplitParticipants')
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
      const customGuestIds = formData.getAll('resplitGuestParticipants')
        .filter((v): v is string => typeof v === 'string' && v.length > 0)

      // IDOR guard: ensure submitted IDs are actual group members
      const validMemberIds = new Set(expense.group.members.map(m => m.userId))
      if (customMemberIds.some(id => !validMemberIds.has(id))) {
        throw new ValidationError('Invalid participant: not a member of this group.')
      }
      if (customGuestIds.length > 0) {
        const groupGuests = await prisma.guestMember.findMany({
          where: { groupId: expense.groupId },
          select: { id: true },
        })
        const validGuestIds = new Set(groupGuests.map(g => g.id))
        if (customGuestIds.some(id => !validGuestIds.has(id))) {
          throw new ValidationError('Invalid guest: not a member of this group.')
        }
      }

      let memberIds: string[]
      let guestIds: string[]

      if (customMemberIds.length > 0 || customGuestIds.length > 0) {
        memberIds = customMemberIds
        guestIds = customGuestIds
      } else {
        memberIds = expense.group.members.map(m => m.userId)
        const groupGuests = await prisma.guestMember.findMany({
          where: { groupId: expense.groupId },
          select: { id: true },
        })
        guestIds = groupGuests.map(g => g.id)
      }

      const totalPeople = memberIds.length + guestIds.length
      if (totalPeople === 0) throw new ValidationError('Pick at least one person to split with.')

      const base = Math.floor(amountCents / totalPeople)
      const remainder = amountCents - base * totalPeople
      const memberShares = memberIds.map(uid => ({
        userId: uid,
        shareCents: uid === expense.payerId ? base + remainder : base,
      }))
      const guestSharesData = guestIds.map(gid => ({ guestId: gid, shareCents: base }))

      await prisma.$transaction([
        prisma.expenseShare.deleteMany({ where: { expenseId } }),
        prisma.guestExpenseShare.deleteMany({ where: { expenseId } }),
        prisma.expense.update({
          where: { id: expenseId },
          data: {
            description,
            amountCents,
            shares: { create: memberShares },
            guestShares: { create: guestSharesData },
          },
        }),
      ])
    } else {
      const original = await prisma.expenseShare.findMany({ where: { expenseId } })
      const oldTotal = original.reduce((sum, s) => sum + s.shareCents, 0)
      if (oldTotal === 0) {
        throw new ValidationError('Activity has no shares to scale — re-split instead.')
      }
      let allocated = 0
      const scaled = original.map((s, i) => {
        const isLast = i === original.length - 1
        const share = isLast
          ? amountCents - allocated
          : Math.round((s.shareCents / oldTotal) * amountCents)
        allocated += share
        return { id: s.id, shareCents: share }
      })
      await prisma.$transaction([
        prisma.expense.update({
          where: { id: expenseId },
          data: { description, amountCents },
        }),
        ...scaled.map(s =>
          prisma.expenseShare.update({
            where: { id: s.id },
            data: { shareCents: s.shareCents },
          }),
        ),
      ])
    }
  })

  if (typeof result === 'string') return result
  if (groupIdForRevalidate) await revalidateGroupMembers(groupIdForRevalidate)
  return null
}

export async function deleteExpense(formData: FormData): Promise<void> {
  const expenseId = getRequiredString(formData, 'expenseId')
  const userId = await getAuthUserId()
  const expense = await requireExpenseMutator(expenseId, userId)
  await prisma.expense.delete({ where: { id: expenseId } })
  await revalidateGroupMembers(expense.groupId)
}

export async function resplitExpense(formData: FormData): Promise<void> {
  const expenseId = getRequiredString(formData, 'expenseId')
  const userId = await getAuthUserId()
  const expense = await requireExpenseMutator(expenseId, userId)

  const memberIds = expense.group.members.map(m => m.userId)
  const shares = equalSplit(expense.amountCents, memberIds, expense.payerId)
  await prisma.$transaction([
    prisma.expenseShare.deleteMany({ where: { expenseId } }),
    prisma.expense.update({
      where: { id: expenseId },
      data: { shares: { create: shares } },
    }),
  ])
  await revalidateGroupMembers(expense.groupId)
}

export async function proposeGroupCooling(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let groupId: string | null = null
  const result = await withValidation(async () => {
    groupId = getRequiredString(formData, 'groupId')
    const description = getRequiredString(formData, 'description')
    const amountCents = getRequiredCents(formData, 'amount')
    const coolingDays = Math.max(1, Math.min(365, parseInt(formData.get('coolingDays') as string || '3', 10)))
    const userId = await getAuthUserId()
    await guard(`propose:${userId}`, 60, 60)
    await requireActiveMembership(groupId, userId)

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { where: { status: 'ACTIVE' }, select: { userId: true } } },
    })
    if (!group) throw new ValidationError('Group not found.')

    const coolingUntil = new Date(Date.now() + coolingDays * 24 * 60 * 60 * 1000)
    const memberIds = group.members.map(m => m.userId)
    const shares = equalSplit(amountCents, memberIds, userId)

    await prisma.expense.create({
      data: {
        groupId,
        payerId: userId,
        amountCents,
        description,
        type: 'PROPOSAL',
        status: 'COOLING',
        coolingUntil,
        shares: { create: shares },
      },
    })
  }, 'action:proposeGroupCooling')

  if (typeof result === 'string') return result
  if (groupId) await revalidateGroupMembers(groupId)
  return null
}

export async function reactToProposal(formData: FormData): Promise<void> {
  const expenseId = getRequiredString(formData, 'expenseId')
  const rawReaction = formData.get('reaction') as string
  if (rawReaction !== 'IN' && rawReaction !== 'SKIP') {
    throw new ValidationError('Invalid reaction.')
  }
  const userId = await getAuthUserId()

  const share = await prisma.expenseShare.findFirst({
    where: { expenseId, userId },
    include: { expense: { select: { groupId: true, type: true, status: true } } },
  })
  if (!share) throw new ValidationError('You are not part of this proposal.')
  if (share.expense.type !== 'PROPOSAL' || share.expense.status !== 'COOLING') {
    throw new ValidationError('This proposal is no longer active.')
  }

  await prisma.expenseShare.update({
    where: { id: share.id },
    data: { reaction: rawReaction },
  })

  await revalidateGroupMembers(share.expense.groupId)
}

export async function commitProposal(formData: FormData): Promise<void> {
  const expenseId = getRequiredString(formData, 'expenseId')
  const userId = await getAuthUserId()

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { group: { select: { id: true } } },
  })
  if (!expense || expense.type !== 'PROPOSAL') throw new ValidationError('Proposal not found.')
  if (expense.payerId !== userId) throw new ValidationError('Only the proposer can commit.')

  await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'COMMITTED', coolingUntil: null },
  })

  await revalidateGroupMembers(expense.group.id)
}

export async function cancelProposal(formData: FormData): Promise<void> {
  const expenseId = getRequiredString(formData, 'expenseId')
  const userId = await getAuthUserId()

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      group: { select: { id: true } },
      shares: { select: { userId: true } },
    },
  })
  if (!expense || expense.type !== 'PROPOSAL') throw new ValidationError('Proposal not found.')

  const isProposer = expense.payerId === userId
  const isParticipant = expense.shares.some(s => s.userId === userId)
  if (!isProposer && !isParticipant) throw new ValidationError('Not part of this proposal.')

  await prisma.expense.update({ where: { id: expenseId }, data: { status: 'CANCELLED' } })
  await revalidateGroupMembers(expense.group.id)
}

export async function resplitAll(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const userId = await getAuthUserId()
  await requireActiveMembership(groupId, userId)

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: { where: { status: 'ACTIVE' }, select: { userId: true } },
      guestMembers: { select: { id: true } },
      expenses: {
        where: { status: 'COMMITTED', NOT: { description: { startsWith: 'Settlement' } } },
        select: { id: true, amountCents: true, payerId: true },
      },
    },
  })
  if (!group) throw new ValidationError('Group not found.')

  const memberIds = group.members.map(m => m.userId)
  const guestIds = group.guestMembers.map(g => g.id)
  const totalPeople = memberIds.length + guestIds.length
  if (totalPeople === 0) throw new ValidationError('This group has no one to split with.')

  await prisma.$transaction(
    group.expenses.flatMap(e => {
      const base = Math.floor(e.amountCents / totalPeople)
      const remainder = e.amountCents - base * totalPeople
      const memberShares = memberIds.map(uid => ({
        userId: uid,
        shareCents: uid === e.payerId ? base + remainder : base,
      }))
      const guestSharesData = guestIds.map(gid => ({ guestId: gid, shareCents: base }))
      return [
        prisma.expenseShare.deleteMany({ where: { expenseId: e.id } }),
        prisma.guestExpenseShare.deleteMany({ where: { expenseId: e.id } }),
        prisma.expense.update({
          where: { id: e.id },
          data: {
            shares: { create: memberShares },
            guestShares: { create: guestSharesData },
          },
        }),
      ]
    }),
  )

  await revalidateGroupMembers(groupId)
  // Land on /groups with the group preselected — the list shell renders the
  // two-pane layout on desktop and bounces mobile to /groups/<id>, so neither
  // viewport gets the wrong layout flash.
  redirect(`/groups?selected=${groupId}`)
}

/**
 * Settle up — records ONLY the per-payment toggles the user explicitly
 * confirmed. Each formData entry like `confirm:<from>:<to>:<cents>` represents
 * one accepted row from the simplified plan.
 */
export async function settleGroup(formData: FormData): Promise<void> {
  const groupId = getRequiredString(formData, 'groupId')
  const userId = await getAuthUserId()
  await requireActiveMembership(groupId, userId)

  const confirmed = formData.getAll('confirm').filter((v): v is string => typeof v === 'string')
  if (confirmed.length === 0) {
    redirect(`/groups?selected=${groupId}`)
  }

  const expenses = await expensesRepo.findByGroup(groupId)
  const plan = settlementPlan(expenses)

  // Resolve guest nodes to their sponsor — guests can't pay or be paid in the
  // DB sense. We surface them as separate rows on the plan, but the actual
  // cashflow always belongs to a real account holder.
  const guestSponsorById = new Map<string, string>()
  const guestNameById = new Map<string, string>()
  for (const e of expenses) {
    for (const gs of (e.guestShares ?? [])) {
      const g = gs.guest as { id?: string; name: string; addedBy: string }
      if (g.id) {
        guestSponsorById.set(g.id, g.addedBy)
        guestNameById.set(g.id, g.name)
      }
    }
  }
  const resolveNode = (node: string): string | null => {
    const guestId = guestIdFromNode(node)
    if (!guestId) return node
    return guestSponsorById.get(guestId) ?? null
  }

  // Filter to confirmed plan rows where the acting user has standing.
  // A user has standing if they're on either side of the resolved row.
  const accepted = plan
    .filter(p => {
      const key = `${p.from}:${p.to}:${p.amountCents}`
      if (!confirmed.includes(key)) return false
      const fromUser = resolveNode(p.from)
      const toUser = resolveNode(p.to)
      return fromUser === userId || toUser === userId
    })

  if (accepted.length === 0) {
    redirect(`/groups?selected=${groupId}`)
  }

  // Settle each row inside a single transaction. For guest rows we also
  // reassign the guest's expense shares to their sponsor up to the row amount,
  // so the next render of the plan correctly removes that guest's debt
  // (otherwise the row would keep showing even after the user confirmed).
  await prisma.$transaction(async tx => {
    for (const p of accepted) {
      const guestId = guestIdFromNode(p.from)
      const fromUser = resolveNode(p.from)
      const toUser = resolveNode(p.to)
      if (!fromUser || !toUser) continue

      if (guestId) {
        // Reassign this guest's GuestExpenseShare records (across the group) to
        // the sponsor's ExpenseShare until we've absorbed `p.amountCents`.
        const sponsorId = fromUser
        let remaining = p.amountCents
        const guestShares = await tx.guestExpenseShare.findMany({
          where: { guestId, expense: { groupId } },
          orderBy: { shareCents: 'desc' },
        })
        for (const gs of guestShares) {
          if (remaining <= 0) break
          const take = Math.min(gs.shareCents, remaining)
          if (take === gs.shareCents) {
            await tx.guestExpenseShare.delete({ where: { id: gs.id } })
          } else {
            await tx.guestExpenseShare.update({
              where: { id: gs.id },
              data: { shareCents: gs.shareCents - take },
            })
          }
          // Upsert the sponsor's ExpenseShare on the same expense, adding the
          // absorbed amount. Composite unique key (expenseId, userId) lets us
          // bump an existing share rather than creating duplicates.
          await tx.expenseShare.upsert({
            where: { expenseId_userId: { expenseId: gs.expenseId, userId: sponsorId } },
            create: { expenseId: gs.expenseId, userId: sponsorId, shareCents: take },
            update: { shareCents: { increment: take } },
          })
          remaining -= take
        }
      }

      // Skip the cash Settlement when sponsor pays themselves (e.g. the user
      // covered their own guest's share of an expense they themselves paid).
      if (fromUser === toUser) continue

      const guestName = guestId ? guestNameById.get(guestId) : undefined
      await tx.expense.create({
        data: {
          groupId,
          payerId: fromUser,
          amountCents: p.amountCents,
          description: guestName ? `Settlement (${guestName})` : 'Settlement',
          type: 'INSTANT',
          status: 'COMMITTED',
          shares: { create: { userId: toUser, shareCents: p.amountCents } },
        },
      })
    }
  })

  await revalidateGroupMembers(groupId)
  redirect(`/groups?selected=${groupId}`)
}
