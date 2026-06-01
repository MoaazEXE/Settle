import { notFound, redirect } from 'next/navigation'
import { groupsRepo } from '@/data/groups.repo'
import { getUserContext } from '@/lib/user-context'
import { computeBalances } from '@/core/debt/groupBalances'
import { GroupDetailShell } from './_components/group-detail-shell'
import { ViewportRedirect } from '../_components/viewport-redirect'

interface PageProps {
  params: Promise<{ id: string }>
}

export interface GroupMemberView {
  id: string
  name: string
  avatarUrl: string | null
  joinedAt: string
  balanceCents: number
}

export interface GroupGuestView {
  id: string
  name: string
  addedBy: string
  createdAt: string
  balanceCents: number
}

export interface GroupActivityView {
  id: string
  type: 'split' | 'settlement'
  title: string
  description: string
  amountCents: number
  perPersonCents: number
  payerId: string
  payerName: string
  shareCount: number
  createdAt: string
}

export interface GroupProposalView {
  id: string
  description: string
  amountCents: number
  proposerId: string
  proposerName: string
  coolingUntil: string
  isCommitted: boolean
  reactions: { userId: string; userName: string; avatarUrl: string | null; reaction: 'IN' | 'SKIP' | null }[]
  myReaction: 'IN' | 'SKIP' | null
}

export default async function GroupPage({ params }: PageProps) {
  const { id } = await params
  const ctx = await getUserContext()
  if (!ctx) redirect('/login')

  const [group, rawProposals] = await Promise.all([
    groupsRepo.findByIdDeep(id, ctx.id),
    groupsRepo.findProposalsByGroup(id, ctx.id),
  ])
  if (!group) notFound()

  const expenses = group.expenses
  const balances = computeBalances(expenses)
  const savedTogetherCents = group.items.reduce((sum, i) => sum + i.amountCents, 0)

  const members: GroupMemberView[] = group.members.map(m => ({
    id: m.user.id,
    name: m.userId === ctx.id ? `${m.user.name} (you)` : m.user.name,
    avatarUrl: m.user.avatarUrl,
    joinedAt: new Date(m.joinedAt).toISOString(),
    balanceCents: balances.get(m.userId) ?? 0,
  }))

  const activity: GroupActivityView[] = expenses.map(e => {
    const isSettlement = e.description.startsWith('Settlement')
    const payerLabel = e.payerId === ctx.id ? 'You' : e.payer.name
    return {
      id: e.id,
      type: isSettlement ? 'settlement' : 'split',
      title: isSettlement
        ? (() => {
            const recipientName = group.members.find(m => m.userId === e.shares[0]?.userId)?.user.name ?? 'a member'
            const guestMatch = e.description.match(/^Settlement \((.+)\)$/)
            const guestName = guestMatch?.[1]
            return guestName
              ? `${guestName} settled with ${recipientName}`
              : `${payerLabel} paid ${recipientName}`
          })()
        : e.description,
      description: e.description,
      amountCents: e.amountCents,
      perPersonCents: e.shares.find(s => s.userId === ctx.id)?.shareCents ?? 0,
      payerId: e.payerId,
      payerName: payerLabel,
      shareCount: e.shares.length + (e.guestShares?.length ?? 0),
      createdAt: new Date(e.createdAt).toISOString(),
    }
  })

  const guests: GroupGuestView[] = group.guestMembers.map(g => ({
    id: g.id,
    name: g.name,
    addedBy: g.addedBy,
    createdAt: new Date(g.createdAt).toISOString(),
    balanceCents: balances.get(`guest:${g.id}`) ?? 0,
  }))

  const proposals: GroupProposalView[] = rawProposals.map(p => ({
    id: p.id,
    description: p.description,
    amountCents: p.amountCents,
    proposerId: p.payerId,
    proposerName: p.payerId === ctx.id ? 'You' : (p.payer?.name ?? 'Member'),
    coolingUntil: new Date(p.coolingUntil!).toISOString(),
    isCommitted: p.status === 'COMMITTED',
    reactions: p.shares.map(s => ({
      userId: s.userId,
      userName: s.userId === ctx.id ? 'You' : s.user.name,
      avatarUrl: s.user.avatarUrl ?? null,
      reaction: (s.reaction as 'IN' | 'SKIP' | null) ?? null,
    })),
    myReaction: (p.shares.find(s => s.userId === ctx.id)?.reaction as 'IN' | 'SKIP' | null) ?? null,
  }))

  return (
    <>
      <ViewportRedirect desktop={`/groups?selected=${group.id}`} />
      <GroupDetailShell
        groupId={group.id}
        groupName={group.name}
        members={members}
        guests={guests}
        activity={activity}
        proposals={proposals}
        currentUserId={ctx.id}
        isCreator={group.createdBy === ctx.id}
        savedTogetherCents={savedTogetherCents}
        youBalanceCents={balances.get(ctx.id) ?? 0}
      />
    </>
  )
}
