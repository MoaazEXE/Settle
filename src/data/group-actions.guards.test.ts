import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * Authorization-guard tests for the group Server Actions (audit #16 — IDOR /
 * authz). These exercise the module-internal guards `requireExpenseMutator`
 * and `requireActiveMembership` *through* their exported callers, since the
 * guards themselves aren't exported and `'use server'` modules don't let us
 * reach into private functions.
 *
 *  - `requireExpenseMutator`  → tested via `deleteExpense`
 *  - `requireActiveMembership` → tested via `addGuestMember`
 *
 * Everything the actions touch (Prisma, Supabase auth, next/cache, the repos,
 * the rate limiter) is mocked, following the conventions in
 * `src/data/groups.repo.test.ts`. No network, no real DB.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockExpense = {
  findUnique: vi.fn(),
  delete: vi.fn(),
}
const mockGroup = {
  findUnique: vi.fn(),
}
const mockGroupMember = {
  findMany: vi.fn(),
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: mockExpense,
    group: mockGroup,
    groupMember: mockGroupMember,
  },
}))

// Auth: default to an authenticated user; individual tests override the id.
const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}))

// ensureUserRecord is a no-op side effect for these tests.
vi.mock('@/lib/ensure-user', () => ({
  ensureUserRecord: vi.fn().mockResolvedValue(undefined),
}))

// next/cache — updateTag just records calls.
const mockUpdateTag = vi.fn()
vi.mock('next/cache', () => ({
  updateTag: (tag: string) => mockUpdateTag(tag),
}))

// next/navigation — redirect would throw in real Next; none of these guards
// reach a redirect, but stub it defensively.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

// Rate limiter — always allow.
vi.mock('@/lib/rate-limit', () => ({
  guard: vi.fn().mockResolvedValue(undefined),
}))

// Repo used by addGuestMember's success path + requireActiveMembership.
const mockRequireActiveMembership = vi.fn()
const mockAddGuestMember = vi.fn()
vi.mock('@/data/groups.repo', () => ({
  groupsRepo: {
    requireActiveMembership: (gid: string, uid: string) =>
      mockRequireActiveMembership(gid, uid),
    addGuestMember: (gid: string, name: string, uid: string) =>
      mockAddGuestMember(gid, name, uid),
  },
}))

// Subject under test — import AFTER mocks.
const { deleteExpense, addGuestMember } = await import('@/app/actions/groups')

// ── Helpers ──────────────────────────────────────────────────────────────────

const GID = 'group-1'
const PAYER = 'user-payer'
const OWNER = 'user-owner'
const OUTSIDER = 'user-outsider'
const EXPENSE_ID = 'expense-1'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.append(k, v)
  return f
}

function authAs(userId: string | null) {
  mockGetCurrentUser.mockResolvedValue(userId ? { id: userId, email: 'x@y.z' } : null)
}

/**
 * Wire up an expense whose group has the given active member ids and a given
 * owner/payer. Mirrors what requireExpenseAccess + requireExpenseMutator read.
 */
function setupExpense(opts: { payerId: string; ownerId: string; memberIds: string[] }) {
  mockExpense.findUnique.mockResolvedValue({
    id: EXPENSE_ID,
    groupId: GID,
    payerId: opts.payerId,
    group: {
      members: opts.memberIds.map(userId => ({ userId })),
    },
  })
  // requireExpenseMutator's second lookup: group.createdBy
  mockGroup.findUnique.mockResolvedValue({ createdBy: opts.ownerId })
  mockGroupMember.findMany.mockResolvedValue(opts.memberIds.map(userId => ({ userId })))
}

// ── requireExpenseMutator (via deleteExpense) ─────────────────────────────────

describe('requireExpenseMutator (via deleteExpense)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows the original payer to delete', async () => {
    authAs(PAYER)
    setupExpense({ payerId: PAYER, ownerId: OWNER, memberIds: [PAYER, OWNER] })
    mockExpense.delete.mockResolvedValue({ id: EXPENSE_ID })

    await expect(deleteExpense(fd({ expenseId: EXPENSE_ID }))).resolves.toBeUndefined()
    expect(mockExpense.delete).toHaveBeenCalledWith({ where: { id: EXPENSE_ID } })
  })

  it('allows the group owner to delete an expense they did not pay', async () => {
    authAs(OWNER)
    setupExpense({ payerId: PAYER, ownerId: OWNER, memberIds: [PAYER, OWNER] })
    mockExpense.delete.mockResolvedValue({ id: EXPENSE_ID })

    await expect(deleteExpense(fd({ expenseId: EXPENSE_ID }))).resolves.toBeUndefined()
    expect(mockExpense.delete).toHaveBeenCalledWith({ where: { id: EXPENSE_ID } })
  })

  it('rejects a member who is neither payer nor owner', async () => {
    // OUTSIDER is an active member (passes requireExpenseAccess) but not the
    // payer and not the owner — must be blocked by requireExpenseMutator.
    authAs(OUTSIDER)
    setupExpense({ payerId: PAYER, ownerId: OWNER, memberIds: [PAYER, OWNER, OUTSIDER] })

    await expect(deleteExpense(fd({ expenseId: EXPENSE_ID }))).rejects.toThrow(
      /only the payer or the group owner/i,
    )
    expect(mockExpense.delete).not.toHaveBeenCalled()
  })

  it('rejects a non-member of the group (requireExpenseAccess)', async () => {
    authAs(OUTSIDER)
    setupExpense({ payerId: PAYER, ownerId: OWNER, memberIds: [PAYER, OWNER] })

    await expect(deleteExpense(fd({ expenseId: EXPENSE_ID }))).rejects.toThrow(
      /not a member of this group/i,
    )
    expect(mockExpense.delete).not.toHaveBeenCalled()
  })

  it('rejects when the expense does not exist', async () => {
    authAs(PAYER)
    mockExpense.findUnique.mockResolvedValue(null)

    await expect(deleteExpense(fd({ expenseId: EXPENSE_ID }))).rejects.toThrow(
      /activity not found/i,
    )
    expect(mockExpense.delete).not.toHaveBeenCalled()
  })
})

// ── requireActiveMembership (via addGuestMember) ──────────────────────────────
// addGuestMember runs inside withValidation, so a ValidationError surfaces as a
// returned string rather than a throw; success returns null.

describe('requireActiveMembership (via addGuestMember)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows an ACTIVE member to add a guest', async () => {
    authAs(PAYER)
    mockRequireActiveMembership.mockResolvedValue(undefined) // ACTIVE → resolves
    mockAddGuestMember.mockResolvedValue({ id: 'guest-1' })
    mockGroupMember.findMany.mockResolvedValue([{ userId: PAYER }])

    const result = await addGuestMember(null, fd({ groupId: GID, guestName: 'Sam' }))
    expect(result).toBeNull()
    expect(mockAddGuestMember).toHaveBeenCalledWith(GID, 'Sam', PAYER)
  })

  it('rejects a non-member (repo rejects → guard maps to validation message)', async () => {
    authAs(OUTSIDER)
    mockRequireActiveMembership.mockRejectedValue(new Error('not a member'))

    const result = await addGuestMember(null, fd({ groupId: GID, guestName: 'Sam' }))
    expect(result).toMatch(/not a member of this group/i)
    expect(mockAddGuestMember).not.toHaveBeenCalled()
  })

  it('rejects a PENDING member (repo rejects → guard maps to validation message)', async () => {
    // The repo's requireActiveMembership rejects for PENDING just like for a
    // missing record; the action surfaces the same "not a member" message.
    authAs(OUTSIDER)
    mockRequireActiveMembership.mockRejectedValue(new Error('pending'))

    const result = await addGuestMember(null, fd({ groupId: GID, guestName: 'Sam' }))
    expect(result).toMatch(/not a member of this group/i)
    expect(mockAddGuestMember).not.toHaveBeenCalled()
  })
})
