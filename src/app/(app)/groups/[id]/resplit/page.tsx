import Link from 'next/link'
import { Scale } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { groupsRepo } from '@/data/groups.repo'
import { getUserContext } from '@/lib/user-context'
import { computeBalances } from '@/core/debt/groupBalances'
import { resplitAll } from '@/app/actions/groups'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { fmtCurrency } from '@/lib/formatters'
import { DEFAULT_CURRENCY } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { GroupBackLink } from '../../_components/group-back-link'
import { ApplyResplitButton } from './_components/apply-button'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ResplitAllPage({ params }: PageProps) {
  const { id } = await params
  const ctx = await getUserContext()
  if (!ctx) redirect('/login')

  const currency = ctx.currency ?? DEFAULT_CURRENCY
  const fmt = (cents: number, decimals: 0 | 2 = 2) => fmtCurrency(cents, currency, decimals)
  const group = await groupsRepo.findByIdDeep(id, ctx.id)
  if (!group) notFound()

  const memberIds = group.members.map(m => m.userId)
  const guestMembers = group.guestMembers
  const totalPeople = memberIds.length + guestMembers.length
  const splitExpenses = group.expenses.filter(e => !e.description.startsWith('Settlement'))

  // Current balances (uses real shares as stored).
  const currentBalances = computeBalances(group.expenses)

  // Projected: replace each split expense's shares with an equal split across
  // all current members + guests. Settlements stay as-is.
  const projectedExpenses = group.expenses.map(e => {
    if (e.description.startsWith('Settlement')) return e
    const base = Math.floor(e.amountCents / totalPeople)
    const remainder = e.amountCents - base * totalPeople
    const memberShares = memberIds.map(uid => ({
      userId: uid,
      shareCents: uid === e.payerId ? base + remainder : base,
    }))
    const projectedGuestShares = guestMembers.map(g => ({
      shareCents: base,
      guest: { addedBy: g.addedBy },
    }))
    return { ...e, shares: memberShares, guestShares: projectedGuestShares }
  })
  const projectedBalances = computeBalances(projectedExpenses)

  const rows = group.members.map(m => {
    const before = currentBalances.get(m.userId) ?? 0
    const after = projectedBalances.get(m.userId) ?? 0
    return {
      id: m.userId,
      name: m.userId === ctx.id ? `${m.user.name} (you)` : m.user.name,
      avatarUrl: m.user.avatarUrl,
      before,
      after,
      delta: after - before,
    }
  })

  const anyChange = rows.some(r => r.delta !== 0)

  return (
    <div className="mx-auto px-5 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-16 max-w-[640px] lg:max-w-5xl">
      <div className="mb-3">
        <GroupBackLink groupId={id} groupName={group.name} />
      </div>

      <div className="lg:bg-card lg:rounded-2xl lg:shadow-card lg:p-8">
      <h1 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight text-foreground">
        Re-split all
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Recomputes every activity (except settlements) as an equal split across all{' '}
        {totalPeople} {totalPeople === 1 ? 'person' : 'people'}
        {guestMembers.length > 0 ? ` (${memberIds.length} members + ${guestMembers.length} guests)` : ''}.
      </p>

      {splitExpenses.length === 0 ? (
        <Card className="mt-5 text-center py-10" padding="none">
          <p className="text-sm font-semibold text-foreground">Nothing to re-split.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add an expense first, then come back here.
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-4 mb-5 flex items-start gap-3 bg-primary-tint rounded-2xl p-4">
            <Scale size={18} strokeWidth={1.8} className="text-primary-deep mt-0.5 flex-shrink-0" />
            <p className="text-xs text-primary-deep leading-relaxed">
              {anyChange
                ? `Affects ${splitExpenses.length} ${
                    splitExpenses.length === 1 ? 'activity' : 'activities'
                  }. Balances change as shown below.`
                : 'Balances already match an equal split — nothing will change.'}
            </p>
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Balance changes
          </p>
          <Card padding="none">
            {rows.map((r, i) => (
              <div
                key={r.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3.5',
                  i < rows.length - 1 && 'border-b border-sep',
                )}
              >
                <Avatar name={r.name} src={r.avatarUrl} size={36} />
                <p className="flex-1 min-w-0 text-sm font-semibold text-foreground truncate">
                  {r.name}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <BalancePill cents={r.before} muted fmt={fmt} />
                  <span className="text-xs text-subtle-foreground">→</span>
                  <BalancePill cents={r.after} fmt={fmt} />
                </div>
                <DeltaTag delta={r.delta} fmt={fmt} />
              </div>
            ))}
          </Card>

          <form
            action={resplitAll}
            className="fixed lg:static bottom-[60px] lg:bottom-auto inset-x-0 lg:inset-auto px-5 lg:px-0 py-3 lg:py-0 lg:mt-6 bg-background lg:bg-transparent border-t lg:border-t-0 border-sep z-10"
          >
            <input type="hidden" name="groupId" value={id} />
            <div className="max-w-[640px] lg:max-w-none mx-auto flex gap-2.5 lg:justify-end">
              <Link
                href={`/groups?selected=${id}`}
                className="flex-1 lg:flex-none lg:px-6 h-12 rounded-lg inline-flex items-center justify-center text-sm font-semibold text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </Link>
              <ApplyResplitButton anyChange={anyChange} />
            </div>
          </form>
        </>
      )}
      </div>
    </div>
  )
}

function BalancePill({ cents, muted = false, fmt }: { cents: number; muted?: boolean; fmt: (c: number, d?: 0 | 2) => string }) {
  const color =
    cents > 0 ? 'text-primary' : cents < 0 ? 'text-coral-deep' : 'text-muted-foreground'
  return (
    <span
      className={cn(
        'text-xs font-semibold tabular-nums',
        muted ? 'text-muted-foreground' : color,
      )}
    >
      {cents === 0 ? '—' : (cents > 0 ? '+' : '−') + fmt(Math.abs(cents), 0)}
    </span>
  )
}

function DeltaTag({ delta, fmt }: { delta: number; fmt: (c: number, d?: 0 | 2) => string }) {
  if (delta === 0) {
    return (
      <span className="text-[11px] text-subtle-foreground tabular-nums w-14 text-right">
        no change
      </span>
    )
  }
  const sign = delta > 0 ? '+' : '−'
  const cls = delta > 0 ? 'text-primary bg-primary-tint' : 'text-coral-deep bg-coral-tint'
  return (
    <span
      className={cn(
        'text-[11px] font-semibold tabular-nums px-2 py-1 rounded-full w-16 text-center',
        cls,
      )}
    >
      {sign}
      {fmt(Math.abs(delta), 0)}
    </span>
  )
}
