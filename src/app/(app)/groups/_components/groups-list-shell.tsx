'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Plus, Users } from 'lucide-react'
import { useFmt } from '@/lib/currency-context'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { acceptInvite, rejectInvite } from '@/app/actions/groups'
import { computeBalances, settlementPlan, guestIdFromNode } from '@/core/debt/groupBalances'
import { CreateGroupSheet } from './create-group-sheet'
import { GroupDetailPanel, GroupDetailPanelEmpty } from './group-detail-panel'
import type { GroupSummary, InvitePreview, RawGroupForShell } from '../page'
import type { GroupMemberView, GroupActivityView, GroupGuestView, GroupProposalView } from '../[id]/page'
import type { PlanRow } from '../[id]/settle/_components/settle-shell'

interface SelectedGroupDetail {
  groupId: string
  groupName: string
  members: GroupMemberView[]
  guests: GroupGuestView[]
  activity: GroupActivityView[]
  proposals: GroupProposalView[]
  savedTogetherCents: number
  youBalanceCents: number
  settlePlan: PlanRow[]
  isCreator: boolean
  openProposalsCount: number
}

interface Props {
  groups: GroupSummary[]
  invites: InvitePreview[]
  totalSavedCents: number
  currentUserId: string
  allGroupsRaw: RawGroupForShell[]
}

export function GroupsListShell({
  groups,
  invites,
  totalSavedCents,
  currentUserId,
  allGroupsRaw,
}: Props) {
  const fmt = useFmt()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Preselect when arriving here from a sub-page (settle/resplit/back from
  // a freshly created group on desktop). Mobile users land on /groups/[id]
  // directly so this is a desktop convenience — but it's viewport-agnostic
  // and harmless on mobile (the right panel doesn't render below `lg`).
  const initialSelectedId = searchParams.get('selected')
  const [creating, setCreating] = useState(false)
  const [pending, startTransition] = useTransition()
  const [actingOn, setActingOn] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialSelectedId)

  // Keep `selectedGroupId` in sync if the user pastes a new ?selected= URL
  // while already on /groups (rare, but cheap to handle).
  useEffect(() => {
    if (initialSelectedId && initialSelectedId !== selectedGroupId) {
      setSelectedGroupId(initialSelectedId)
    }
  }, [initialSelectedId, selectedGroupId])

  // Mobile doesn't render the right panel, so a `?selected=<id>` arrival there
  // (e.g. from a desktop-style redirect after settle/resplit) should bounce
  // into the dedicated detail page so the user sees the group they meant.
  useEffect(() => {
    if (!initialSelectedId) return
    if (typeof window === 'undefined') return
    const isMobile = !window.matchMedia('(min-width: 1024px)').matches
    if (isMobile) router.replace(`/groups/${initialSelectedId}`)
  }, [initialSelectedId, router])

  // After a delete/leave from the right panel, clear selection and refetch so
  // the panel doesn't keep showing a now-vanished group.
  function handleRemoved() {
    setSelectedGroupId(null)
    router.refresh()
  }

  // Derive the right-panel detail entirely from already-loaded data.
  // No network round-trip — selecting a group is instant.
  const selectedDetail = useMemo((): SelectedGroupDetail | null => {
    if (!selectedGroupId) return null
    const g = allGroupsRaw.find(g => g.id === selectedGroupId)
    if (!g) return null

    // expenses type must satisfy computeBalances / settlementPlan signatures
    const expenses = g.expenses as Parameters<typeof computeBalances>[0]
    const balances = computeBalances(expenses)
    const savedTogetherCents = g.items.reduce((sum, i) => sum + i.amountCents, 0)

    const nameById = new Map(g.members.map(m => [m.userId, m.user.name]))
    const avatarById = new Map(g.members.map(m => [m.userId, m.user.avatarUrl]))
    const guestById = new Map(g.guestMembers.map(gm => [gm.id, { name: gm.name, sponsor: gm.addedBy }]))

    const labelForNode = (node: string): string => {
      const guestId = guestIdFromNode(node)
      if (guestId) {
        const gg = guestById.get(guestId)
        return gg ? gg.name : 'Guest'
      }
      return nameById.get(node) ?? 'Member'
    }
    const avatarForNode = (node: string): string | null => {
      if (guestIdFromNode(node)) return null
      return avatarById.get(node) ?? null
    }
    const kindOfNode = (node: string): 'me' | 'my-guest' | 'others-guest' | 'user' => {
      const guestId = guestIdFromNode(node)
      if (guestId) {
        return guestById.get(guestId)?.sponsor === currentUserId ? 'my-guest' : 'others-guest'
      }
      return node === currentUserId ? 'me' : 'user'
    }
    const involvesMe = (node: string): boolean => {
      const k = kindOfNode(node)
      return k === 'me' || k === 'my-guest'
    }

    const members: GroupMemberView[] = g.members.map(m => ({
      id: m.user.id,
      name: m.userId === currentUserId ? `${m.user.name} (you)` : m.user.name,
      avatarUrl: m.user.avatarUrl,
      joinedAt: m.joinedAt, // already an ISO string
      balanceCents: balances.get(m.userId) ?? 0,
    }))

    const activity: GroupActivityView[] = g.expenses.map(e => {
      const isSettlement = e.description.startsWith('Settlement')
      const payerLabel = e.payerId === currentUserId ? 'You' : e.payer.name
      return {
        id: e.id,
        type: isSettlement ? 'settlement' : 'split',
        title: isSettlement
          ? (() => {
              const recipientName = g.members.find(m => m.userId === e.shares[0]?.userId)?.user.name ?? 'a member'
              const guestMatch = e.description.match(/^Settlement \((.+)\)$/)
              const guestName = guestMatch?.[1]
              return guestName
                ? `${guestName} settled with ${recipientName}`
                : `${payerLabel} paid ${recipientName}`
            })()
          : e.description,
        description: e.description,
        amountCents: e.amountCents,
        perPersonCents: e.shares.find(s => s.userId === currentUserId)?.shareCents ?? 0,
        payerId: e.payerId,
        payerName: payerLabel,
        shareCount: e.shares.length + (e.guestShares?.length ?? 0),
        createdAt: e.createdAt, // already an ISO string
      }
    })

    const plan: PlanRow[] = settlementPlan(expenses).map(p => ({
      fromId: p.from,
      fromLabel: labelForNode(p.from),
      fromAvatarUrl: avatarForNode(p.from),
      toId: p.to,
      toLabel: labelForNode(p.to),
      toAvatarUrl: avatarForNode(p.to),
      amountCents: p.amountCents,
      involvesYou: involvesMe(p.from) || involvesMe(p.to),
      youArePayer: involvesMe(p.from),
      fromKind: kindOfNode(p.from),
      toKind: kindOfNode(p.to),
      guestBreakdown: [],
    }))

    const guests: GroupGuestView[] = g.guestMembers.map(gm => ({
      id: gm.id,
      name: gm.name,
      addedBy: gm.addedBy,
      createdAt: gm.createdAt,
      balanceCents: balances.get(`guest:${gm.id}`) ?? 0,
    }))

    const proposals: GroupProposalView[] = g.proposals.map(p => ({
      id: p.id,
      description: p.description,
      amountCents: p.amountCents,
      proposerId: p.payerId,
      proposerName: p.payerId === currentUserId ? 'You' : p.payerName,
      coolingUntil: p.coolingUntil,
      isCommitted: p.status === 'COMMITTED',
      reactions: p.shares.map(s => ({
        userId: s.userId,
        userName: s.userId === currentUserId ? 'You' : s.userName,
        avatarUrl: s.avatarUrl,
        reaction: (s.reaction as 'IN' | 'SKIP' | null) ?? null,
      })),
      myReaction: (p.shares.find(s => s.userId === currentUserId)?.reaction as 'IN' | 'SKIP' | null) ?? null,
    }))

    return {
      groupId: g.id,
      groupName: g.name,
      members,
      guests,
      activity,
      proposals,
      savedTogetherCents,
      youBalanceCents: balances.get(currentUserId) ?? 0,
      settlePlan: plan,
      isCreator: g.createdBy === currentUserId,
      openProposalsCount: proposals.filter(p => !p.isCommitted).length,
    }
  }, [selectedGroupId, allGroupsRaw, currentUserId])

  function handleAccept(groupId: string) {
    setActingOn(groupId)
    const fd = new FormData()
    fd.set('groupId', groupId)
    startTransition(async () => {
      await acceptInvite(fd)
      setActingOn(null)
    })
  }

  function handleReject(groupId: string) {
    setActingOn(groupId)
    const fd = new FormData()
    fd.set('groupId', groupId)
    startTransition(async () => {
      await rejectInvite(fd)
      setActingOn(null)
    })
  }

  return (
    <>
      {/* ── Desktop two-panel layout ── */}
      <div className="hidden lg:flex flex-col px-8 pt-8 pb-8 min-h-full">
        <header className="mb-5">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground">
            Groups
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Split real expenses. Cool on shared impulse buys together.
          </p>
        </header>

        <div className="flex gap-4 items-start">
          {/* Left panel */}
          <div className="w-[270px] flex-shrink-0 flex flex-col gap-2">
            {invites.length > 0 && (
              <div className="mb-1 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
                  {invites.length === 1 ? 'Pending invite' : `Pending invites · ${invites.length}`}
                </p>
                {invites.map(inv => {
                  const busy = pending && actingOn === inv.groupId
                  return (
                    <Card key={inv.groupId} padding="sm" className="border border-primary-soft">
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary-tint flex items-center justify-center text-primary-deep">
                          <Users size={16} strokeWidth={1.8} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{inv.groupName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {inv.memberCount} {inv.memberCount === 1 ? 'member' : 'members'}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleReject(inv.groupId)}
                          disabled={!!busy}
                          className="flex-1 h-8 rounded-md text-[11px] font-semibold text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          {busy ? '…' : 'Reject'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAccept(inv.groupId)}
                          disabled={!!busy}
                          className="flex-1 h-8 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary-deep transition-colors disabled:opacity-50"
                        >
                          {busy ? '…' : 'Accept'}
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}

            {groups.length === 0 ? (
              <Card padding="sm" className="text-center py-6">
                <p className="text-xs font-semibold text-foreground">No groups yet.</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Create one to get started.</p>
              </Card>
            ) : (
              groups.map(g => (
                <DesktopGroupRow
                  key={g.id}
                  group={g}
                  selected={selectedGroupId === g.id}
                  onSelect={() => setSelectedGroupId(g.id)}
                />
              ))
            )}

            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 w-full rounded-2xl border-[1.5px] border-dashed border-sep-strong px-4 py-3 text-center transition-colors hover:bg-card"
            >
              <p className="text-sm font-semibold text-primary">+ Create new group</p>
            </button>
          </div>

          {/* Right panel */}
          <div className="flex-1 min-w-0 rounded-2xl bg-card shadow-card overflow-hidden">
            {selectedDetail ? (
              <GroupDetailPanel
                key={selectedDetail.groupId}
                groupId={selectedDetail.groupId}
                groupName={selectedDetail.groupName}
                members={selectedDetail.members}
                guests={selectedDetail.guests}
                activity={selectedDetail.activity}
                proposals={selectedDetail.proposals}
                currentUserId={currentUserId}
                isCreator={selectedDetail.isCreator}
                savedTogetherCents={selectedDetail.savedTogetherCents}
                youBalanceCents={selectedDetail.youBalanceCents}
                settlePlan={selectedDetail.settlePlan}
                openProposalsCount={selectedDetail.openProposalsCount}
                onAfterRemoved={handleRemoved}
              />
            ) : (
              <GroupDetailPanelEmpty />
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile layout ── */}
      <div className="lg:hidden max-w-[640px] mx-auto px-5 pt-6 pb-8">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              Groups
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Split real expenses. Cool on shared impulse buys.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Create group"
            className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center hover:bg-foreground/5 transition-colors"
          >
            <Plus size={20} strokeWidth={2} className="text-foreground" />
          </button>
        </header>

        {invites.length > 0 && (
          <div className="mb-5 space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {invites.length === 1 ? 'Pending invite' : `Pending invites · ${invites.length}`}
            </p>
            {invites.map(inv => {
              const busy = pending && actingOn === inv.groupId
              return (
                <Card key={inv.groupId} padding="sm" className="border border-primary-soft">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary-tint flex items-center justify-center text-primary-deep">
                      <Users size={18} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{inv.groupName}</p>
                      <p className="text-xs text-muted-foreground">
                        Invited you · {inv.memberCount}{' '}
                        {inv.memberCount === 1 ? 'member' : 'members'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleReject(inv.groupId)}
                      disabled={!!busy}
                      className="flex-1 h-11 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {busy ? '…' : 'Reject'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAccept(inv.groupId)}
                      disabled={!!busy}
                      className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary-deep transition-colors disabled:opacity-50"
                    >
                      {busy ? '…' : 'Accept'}
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        <div className="rounded-2xl p-5 mb-5 text-white shadow-card bg-gradient-to-br from-primary to-primary-deep">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Saved together</p>
          <p className="mt-1 font-display text-4xl font-semibold tabular-nums tracking-tight">
            {fmt(totalSavedCents)}
          </p>
          <p className="mt-1 text-xs opacity-70">
            Across {groups.length} {groups.length === 1 ? 'group' : 'groups'}, all time
          </p>
        </div>

        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your groups
        </p>

        {groups.length === 0 ? (
          <EmptyState
            title="No groups yet."
            subtitle="Create one to split expenses or cool on something together."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {groups.map(g => (
              <MobileGroupRow key={g.id} group={g} />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mt-4 w-full rounded-2xl border-[1.5px] border-dashed border-sep-strong px-4 py-3.5 text-center transition-colors hover:bg-card"
        >
          <p className="text-sm font-semibold text-primary">+ Create new group</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Split, cool, save together</p>
        </button>
      </div>

      {creating && (
        <CreateGroupSheet
          onClose={() => setCreating(false)}
          onCreated={id => setSelectedGroupId(id)}
        />
      )}
    </>
  )
}

function DesktopGroupRow({
  group,
  selected,
  onSelect,
}: {
  group: GroupSummary
  selected: boolean
  onSelect: () => void
}) {
  // Merge members + guests so the visible avatar strip and count reflect both.
  const people: { id: string; name: string; avatarUrl: string | null }[] = [
    ...group.members,
    ...group.guests.map(g => ({ id: `guest:${g.id}`, name: g.name, avatarUrl: null })),
  ]
  const totalPeople = group.memberCount + group.guestCount

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left transition-all',
        selected
          ? 'shadow-card-hover ring-1 ring-primary/20'
          : 'shadow-card hover:-translate-y-[1px] hover:shadow-card-hover',
      )}
    >
      <Avatar name={group.name} size={44} shape="square" className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{group.name}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <div className="flex">
            {people.slice(0, 4).map((p, i) => (
              <div
                key={p.id}
                className="rounded-full shadow-avatar-ring"
                style={{ marginLeft: i > 0 ? -6 : 0 }}
              >
                <Avatar name={p.name} src={p.avatarUrl} size={18} />
              </div>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {totalPeople} {totalPeople === 1 ? 'member' : 'members'}
          </span>
        </div>
      </div>
      <DesktopBalanceBadge cents={group.youOweCents} />
    </button>
  )
}

function DesktopBalanceBadge({ cents }: { cents: number }) {
  const fmt = useFmt()
  if (cents === 0) {
    return <span className="text-xs font-medium text-muted-foreground">Settled</span>
  }
  return (
    <span
      className={cn(
        'text-sm font-bold tabular-nums flex-shrink-0',
        cents > 0 ? 'text-primary' : 'text-coral-deep',
      )}
    >
      {cents > 0 ? '+' : '−'}
      {fmt(Math.abs(cents), 0)}
    </span>
  )
}

function MobileGroupRow({ group }: { group: GroupSummary }) {
  const people: { id: string; name: string; avatarUrl: string | null }[] = [
    ...group.members,
    ...group.guests.map(g => ({ id: `guest:${g.id}`, name: g.name, avatarUrl: null })),
  ]
  const totalPeople = group.memberCount + group.guestCount

  return (
    <Link
      href={`/groups/${group.id}`}
      prefetch
      className="block rounded-2xl bg-card shadow-card px-4 py-3.5 transition-all hover:-translate-y-[2px] hover:shadow-card-hover"
    >
      <div className="flex items-center gap-3.5">
        <Avatar name={group.name} size={46} shape="square" className="flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-body-lg font-semibold text-foreground truncate">{group.name}</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex">
              {people.slice(0, 4).map((p, i) => (
                <div
                  key={p.id}
                  className="rounded-full shadow-avatar-ring"
                  style={{ marginLeft: i > 0 ? -6 : 0 }}
                >
                  <Avatar name={p.name} src={p.avatarUrl} size={20} />
                </div>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {totalPeople} {totalPeople === 1 ? 'member' : 'members'}
            </span>
          </div>
        </div>
        <MobileBalanceBadge cents={group.youOweCents} />
      </div>
    </Link>
  )
}

function MobileBalanceBadge({ cents }: { cents: number }) {
  const fmt = useFmt()
  if (cents === 0) {
    return <span className="text-xs font-medium text-muted-foreground">Settled</span>
  }
  if (cents > 0) {
    return (
      <div className="text-right">
        <p className="text-[11px] font-medium text-muted-foreground">You&apos;re owed</p>
        <p className="text-body-lg font-bold text-primary tabular-nums">{fmt(cents, 0)}</p>
      </div>
    )
  }
  return (
    <div className="text-right">
      <p className="text-[11px] font-medium text-muted-foreground">You owe</p>
      <p className="text-body-lg font-bold text-coral-deep tabular-nums">
        {fmt(Math.abs(cents), 0)}
      </p>
    </div>
  )
}
