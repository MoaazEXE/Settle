'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowRight, Sparkles, Check, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { useFmt } from '@/lib/currency-context'
import { cn } from '@/lib/utils'
import { settleGroup } from '@/app/actions/groups'
import { GroupBackLink } from '@/app/(app)/groups/_components/group-back-link'

/**
 * What kind of party appears on each side of a plan row, from the acting
 * user's point of view. Drives the copy in PaymentRow so we never end up
 * with confusing "You pay → You" labels when a guest is involved.
 */
export type PartyKind =
  | 'me'           // The acting user themselves.
  | 'my-guest'     // A guest the acting user sponsors.
  | 'others-guest' // A guest someone else sponsors.
  | 'user'         // Any other real user.

export interface PlanRow {
  fromId: string
  fromLabel: string
  fromAvatarUrl: string | null
  toId: string
  toLabel: string
  toAvatarUrl: string | null
  amountCents: number
  // Who's allowed to confirm this row.
  involvesYou: boolean
  youArePayer: boolean
  // Categorise both sides so PaymentRow can pick the right copy for the
  // four guest-involved permutations, not just user-vs-user.
  fromKind: PartyKind
  toKind: PartyKind
  // Guests of `from` whose shares contributed to this debt. Rendered as a
  // sub-line under the row so users see exactly who they're covering for.
  guestBreakdown?: { guestName: string; shareCents: number }[]
}

export interface EvidenceRow {
  id: string
  title: string
  payerName: string
  shareCount: number
  amountCents: number
  guestNames?: string[]
}

interface Props {
  groupId: string
  groupName: string
  plan: PlanRow[]
  evidence: EvidenceRow[]
}

export function SettleShell({ groupId, groupName, plan, evidence }: Props) {
  const fmt = useFmt()
  // Default-checked: rows you pay. Incoming rows (someone owes you) default OFF
  // until you explicitly confirm receipt.
  const [confirmed, setConfirmed] = useState<Set<string>>(
    () => new Set(plan.filter(r => r.youArePayer).map(rowKey)),
  )
  const [submitting, startSubmit] = useTransition()

  const youInvolved = plan.filter(r => r.involvesYou)
  const othersOnly = plan.filter(r => !r.involvesYou)

  function toggle(key: string) {
    setConfirmed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function submit() {
    if (confirmed.size === 0) {
      toast.error('Tick at least one payment to mark as paid.')
      return
    }
    const fd = new FormData()
    fd.set('groupId', groupId)
    for (const k of confirmed) fd.append('confirm', k)
    startSubmit(async () => {
      try {
        await settleGroup(fd)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not record payments.'
        if (!msg.includes('NEXT_REDIRECT')) toast.error(msg)
      }
    })
  }

  return (
    <div className="mx-auto px-5 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-16 max-w-[640px] lg:max-w-5xl">
      <div className="mb-3">
        <GroupBackLink groupId={groupId} groupName={groupName} />
      </div>

      {/* Desktop wraps the whole settle UI in a card so it lives in the same
          design surface as the right-panel detail. Mobile keeps the flat
          page-level rendering for the small viewport. */}
      <div className="lg:bg-card lg:rounded-2xl lg:shadow-card lg:p-8">
      <h1 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight text-foreground">
        Settle up
      </h1>

      {plan.length === 0 ? (
        <Card className="mt-5 text-center py-10" padding="none">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary-tint flex items-center justify-center text-primary mb-3">
            <Check size={20} strokeWidth={2} />
          </div>
          <p className="text-sm font-semibold text-foreground">Everyone&apos;s already even.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No outstanding balances in this group.
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-4 mb-5 flex items-start gap-3 bg-primary-tint rounded-2xl p-4">
            <Sparkles size={18} strokeWidth={1.8} className="text-primary-deep mt-0.5 flex-shrink-0" />
            <p className="text-xs text-primary-deep leading-relaxed">
              Simplified to the fewest possible payments. Just{' '}
              <strong>
                {plan.length} {plan.length === 1 ? 'transfer' : 'transfers'}
              </strong>{' '}
              and everyone&apos;s even. Tick the ones that have actually happened.
            </p>
          </div>

          {youInvolved.length > 0 && (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Payments
              </p>
              <Card padding="none">
                {youInvolved.map((row, i) => (
                  <div
                    key={rowKey(row)}
                    className={cn(i < youInvolved.length - 1 && 'border-b border-sep')}
                  >
                    <PaymentRow
                      row={row}
                      checked={confirmed.has(rowKey(row))}
                      onToggle={() => toggle(rowKey(row))}
                      last
                    />
                    {row.guestBreakdown && row.guestBreakdown.length > 0 && (
                      <p className="px-4 pb-3 -mt-2 text-[10px] text-subtle-foreground">
                        Includes{' '}
                        {row.guestBreakdown
                          .map(g => `${g.guestName}'s ${fmt(g.shareCents, 0)}`)
                          .join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </Card>
            </>
          )}

          {othersOnly.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Between other members
              </p>
              <Card padding="none">
                {othersOnly.map((row, i) => (
                  <div
                    key={rowKey(row)}
                    className={cn(
                      'flex flex-col gap-1 px-4 py-3.5 opacity-70',
                      i < othersOnly.length - 1 && 'border-b border-sep',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={row.fromLabel} src={row.fromAvatarUrl} size={32} />
                      <p className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
                        <span className="font-semibold text-foreground">{row.fromLabel}</span>{' '}
                        pays{' '}
                        <span className="font-semibold text-foreground">{row.toLabel}</span>
                      </p>
                      <p className="text-sm font-bold text-foreground tabular-nums">
                        {fmt(row.amountCents)}
                      </p>
                    </div>
                    {row.guestBreakdown && row.guestBreakdown.length > 0 && (
                      <p className="text-[10px] text-subtle-foreground pl-11">
                        Includes{' '}
                        {row.guestBreakdown
                          .map(g => `${g.guestName}'s ${fmt(g.shareCents, 0)}`)
                          .join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </Card>
              <p className="mt-2 text-[11px] text-subtle-foreground">
                You can only confirm payments that involve you. They&apos;ll mark theirs when it
                happens.
              </p>
            </>
          )}

          {evidence.length > 0 && (
            <>
              <p className="mt-7 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How we got there
              </p>
              <Card padding="none">
                {evidence.map((e, i) => (
                  <div
                    key={e.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3.5',
                      i < evidence.length - 1 && 'border-b border-sep',
                    )}
                  >
                    <div className="w-9 h-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center flex-shrink-0">
                      <ShoppingBag size={15} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{e.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {e.payerName} paid · split {e.shareCount}{' '}
                        {e.shareCount === 1 ? 'way' : 'ways'}
                      </p>
                      {e.guestNames && e.guestNames.length > 0 && (
                        <p className="text-[10px] text-subtle-foreground mt-0.5 truncate">
                          With {e.guestNames.join(', ')}
                        </p>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {fmt(e.amountCents, 0)}
                    </p>
                  </div>
                ))}
              </Card>
            </>
          )}

          <div className="fixed lg:static bottom-[60px] lg:bottom-auto inset-x-0 lg:inset-auto px-5 lg:px-0 py-3 lg:py-0 lg:mt-6 bg-background lg:bg-transparent border-t lg:border-t-0 border-sep z-10">
            <div className="max-w-[640px] lg:max-w-none mx-auto flex gap-2.5 lg:justify-end">
              <Link
                href={`/groups?selected=${groupId}`}
                className="flex-1 lg:flex-none lg:px-6 h-12 rounded-lg inline-flex items-center justify-center text-sm font-semibold text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </Link>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || confirmed.size === 0}
                className="flex-[1.4] lg:flex-none lg:px-8 h-12 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-primary-deep transition-colors active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check size={16} strokeWidth={2} />
                {submitting
                  ? 'Recording…'
                  : `Mark ${confirmed.size} as paid`}
              </button>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  )
}

function rowKey(r: { fromId: string; toId: string; amountCents: number }): string {
  return `${r.fromId}:${r.toId}:${r.amountCents}`
}

function PaymentRow({
  row,
  checked,
  onToggle,
  last,
}: {
  row: PlanRow
  checked: boolean
  onToggle: () => void
  last: boolean
}) {
  const fmt = useFmt()

  // Compose a small caption that explains the row from the acting user's
  // POV. Always uses real names — no "You" / "them" — so guest cases like
  // "Sarah (your guest) → Moaaz" read straightforwardly.
  function fromTag(kind: PlanRow['fromKind']): string | null {
    switch (kind) {
      case 'me': return 'You'
      case 'my-guest': return 'Your guest'
      case 'others-guest': return 'Guest'
      case 'user': return null
    }
  }
  function toTag(kind: PlanRow['toKind']): string | null {
    return kind === 'me' ? 'You' : null
  }
  function helperFor(r: PlanRow): string {
    if (r.fromKind === 'my-guest' && r.toKind === 'me') {
      return 'Already covered by you — tap to clear'
    }
    if (r.fromKind === 'my-guest') {
      return `You'll pay ${r.toLabel} for ${r.fromLabel}`
    }
    if (r.fromKind === 'me') {
      return `Tap when you've paid ${r.toLabel}`
    }
    // Someone else (or their guest) pays the acting user.
    return `Tap when ${r.fromLabel} has paid you`
  }

  const fromTagText = fromTag(row.fromKind)
  const toTagText = toTag(row.toKind)

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-2 sm:gap-3 px-4 py-3.5 transition-colors text-left',
        checked ? 'bg-primary-tint/40' : 'hover:bg-muted',
        !last && 'border-b border-sep',
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-auto sm:flex-none">
        <Avatar name={row.fromLabel} src={row.fromAvatarUrl} size={36} />
        <div className="flex flex-col min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {row.fromLabel}
          </p>
          {fromTagText && (
            <p className="text-[10px] font-medium text-muted-foreground truncate">
              {fromTagText}
            </p>
          )}
        </div>
      </div>
      <div className="w-7 h-7 rounded-full bg-primary-tint text-primary flex items-center justify-center flex-shrink-0">
        <ArrowRight size={14} strokeWidth={2} />
      </div>
      <div className="flex items-center gap-2 min-w-0 flex-auto sm:flex-none">
        <Avatar name={row.toLabel} src={row.toAvatarUrl} size={36} />
        <div className="flex flex-col min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {row.toLabel}
          </p>
          {toTagText && (
            <p className="text-[10px] font-medium text-muted-foreground truncate">
              {toTagText}
            </p>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 hidden sm:flex flex-col items-start">
        <p className="text-[10px] text-subtle-foreground truncate">{helperFor(row)}</p>
      </div>
      <p className="text-base font-bold text-foreground tabular-nums flex-shrink-0 text-right">
        {fmt(row.amountCents)}
      </p>
      <span
        className={cn(
          'flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors',
          checked ? 'bg-primary text-primary-foreground' : 'border border-border bg-card',
        )}
      >
        {checked && <Check size={14} strokeWidth={2.5} />}
      </span>
    </button>
  )
}
