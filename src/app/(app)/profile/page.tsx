import { redirect } from 'next/navigation'
import { getUserContext } from '@/lib/user-context'
import { usersRepo } from '@/data/users.repo'
import { itemsRepo } from '@/data/items.repo'
import { groupsRepo } from '@/data/groups.repo'
import {
  computeSkipRate,
  summarizeSkipped,
  computeSavingsStreak,
  bucketSavingsByDayRaw,
} from '@/core/savings/savings'
import { computeMilestones } from '@/core/milestones/milestones'
import { CATEGORIES, DEFAULT_CATEGORY } from '@/core/categories/categories'
import { ProfileShell } from './_components/profile-shell'

export default async function ProfilePage() {
  const ctx = await getUserContext()
  if (!ctx) redirect('/login')

  const [coolingItems, skippedItems, boughtItems, groups, dbUser] = await Promise.all([
    itemsRepo.findCoolingByUser(ctx.id),
    itemsRepo.findSkippedByUser(ctx.id),
    itemsRepo.findBoughtByUser(ctx.id),
    groupsRepo.findManyByUserDeep(ctx.id),
    usersRepo.findById(ctx.id),
  ])

  const summary = summarizeSkipped(skippedItems, 30)
  const summaryQuarter = summarizeSkipped(skippedItems, 90)
  const summaryPrevQuarter = summarizeSkipped(
    skippedItems.filter(i => {
      const t = i.resolvedAt ? new Date(i.resolvedAt).getTime() : 0
      const now = Date.now()
      return t >= now - 180 * 86_400_000 && t < now - 90 * 86_400_000
    }),
    90,
  )
  const skipRatePct = computeSkipRate(skippedItems.length, boughtItems.length)

  // Streak
  const rawByDay = bucketSavingsByDayRaw(skippedItems, 90)
  const streakDays = computeSavingsStreak(rawByDay)

  // Milestones
  const groupCoolingActive = groups.some(g =>
    g.expenses.some(e => e.type === 'PROPOSAL' && e.status === 'COOLING'),
  )
  const milestones = computeMilestones({
    skippedItems: skippedItems.map(i => ({
      amountCents: i.amountCents,
      coolingUntil: i.coolingUntil,
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt,
    })),
    boughtItems,
    totalSavedCents: summary.totalCents,
    groupCoolingActive,
  })

  // Most skipped categories
  const catCount = new Map<string, number>()
  for (const item of skippedItems) {
    const cat = item.category ?? DEFAULT_CATEGORY
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1)
  }
  const totalSkipped = skippedItems.length
  const mostSkipped = Array.from(catCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({
      id,
      label: CATEGORIES.find(c => c.id === id)?.label ?? 'Other',
      count,
      pct: totalSkipped > 0 ? Math.round((count / totalSkipped) * 100) : 0,
    }))

  // Personal records
  const biggestSaveCents = skippedItems.length > 0
    ? Math.max(...skippedItems.map(i => i.amountCents))
    : 0
  const biggestSaveTitle = skippedItems.find(i => i.amountCents === biggestSaveCents)?.title ?? '—'
  const avgSaveCents = skippedItems.length > 0
    ? Math.round(skippedItems.reduce((s, i) => s + i.amountCents, 0) / skippedItems.length)
    : 0

  // Recent activity (last 5 resolved items)
  const recentActivity = [
    ...skippedItems.map(i => ({ ...i, status: 'SKIPPED' as const })),
    ...boughtItems.map(i => ({ ...i, status: 'BOUGHT' as const })),
  ]
    .filter(i => i.resolvedAt)
    .sort((a, b) => (b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0) - (a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0))
    .slice(0, 5)

  const hourlyWageCents = dbUser?.monthlyIncomeCents && dbUser.workingHoursPerWeek
    ? dbUser.monthlyIncomeCents / (dbUser.workingHoursPerWeek * 4.33)
    : null
  const lifeHours = hourlyWageCents ? summary.totalCents / hourlyWageCents : null

  // Quarter comparison
  const prevQTotal = summaryPrevQuarter.totalCents
  const thisQTotal = summaryQuarter.thisMonthCents > 0
    ? summaryQuarter.totalCents
    : summaryQuarter.totalCents
  const quarterVsPrev = prevQTotal > 0
    ? Math.round(((thisQTotal - prevQTotal) / prevQTotal) * 100)
    : null

  return (
    <ProfileShell
      name={ctx.name}
      email={ctx.email}
      initial={ctx.initial}
      avatarUrl={dbUser?.avatarUrl ?? null}
      username={ctx.username}
      memberSince={dbUser?.createdAt ? new Date(dbUser.createdAt) : new Date()}
      savedCents={summary.totalCents}
      skippedCount={skippedItems.length}
      boughtCount={boughtItems.length}
      coolingCount={coolingItems.length}
      skipRatePct={skipRatePct}
      groupsCount={groups.length}
      streakDays={streakDays}
      biggestSaveCents={biggestSaveCents}
      biggestSaveTitle={biggestSaveTitle}
      avgSaveCents={avgSaveCents}
      lifeHours={lifeHours}
      milestones={milestones}
      mostSkipped={mostSkipped}
      quarterSavedCents={thisQTotal}
      quarterSkippedCount={skippedItems.filter(i => {
        const t = i.resolvedAt ? new Date(i.resolvedAt).getTime() : 0
        return t >= Date.now() - 90 * 86_400_000
      }).length}
      quarterVsPrevPct={quarterVsPrev}
      notifyCoolingReady={dbUser?.notifyCoolingReady ?? true}
      notifyGroupActivity={dbUser?.notifyGroupActivity ?? true}
      notifyMilestoneUnlocked={dbUser?.notifyMilestoneUnlocked ?? true}
      recentActivity={recentActivity.map(i => ({
        id: i.id,
        title: i.title,
        amountCents: i.amountCents,
        status: i.status,
        resolvedAt: i.resolvedAt!,
      }))}
    />
  )
}
