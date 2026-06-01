'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  ArrowRight,
  LogOut,
  Users,
  ChevronRight,
  Pencil,
  Bell,
  Tag,
  Download,
  CalendarRange,
} from 'lucide-react'
import { signOut, deleteAccount } from '@/app/actions/auth'
import { updateNotificationPrefs } from '@/app/actions/users'
import { useFmt } from '@/lib/currency-context'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MilestoneCard } from '@/components/milestones/milestone-card'
import { cn, toDate } from '@/lib/utils'
import { EditProfileSheet } from './edit-profile-sheet'
import type { MilestoneResult } from '@/core/milestones/milestones'

interface ActivityItem {
  id: string
  title: string
  amountCents: number
  status: 'SKIPPED' | 'BOUGHT'
  resolvedAt: Date | string
}

interface MostSkippedRow {
  id: string
  label: string
  count: number
  pct: number
}

interface Props {
  name: string
  email: string
  initial: string
  avatarUrl: string | null
  username: string | null
  memberSince: Date | string
  savedCents: number
  skippedCount: number
  boughtCount: number
  coolingCount: number
  skipRatePct: number
  groupsCount: number
  streakDays: number
  biggestSaveCents: number
  biggestSaveTitle: string
  avgSaveCents: number
  lifeHours: number | null
  milestones: MilestoneResult
  mostSkipped: MostSkippedRow[]
  quarterSavedCents: number
  quarterSkippedCount: number
  quarterVsPrevPct: number | null
  notifyCoolingReady: boolean
  notifyGroupActivity: boolean
  notifyMilestoneUnlocked: boolean
  recentActivity: ActivityItem[]
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h.toFixed(1)}h`
  const days = Math.floor(h / 24)
  return `${days}d ${Math.round(h % 24)}h`
}

function relativeTime(date: Date | string): string {
  const d = toDate(date)
  const diff = Date.now() - d.getTime()
  if (diff < 3_600_000) return 'Just now'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-MY', { month: 'short', day: 'numeric' })
}

function fmtMemberSince(date: Date | string): string {
  return toDate(date).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
}

export function ProfileShell({
  name,
  email,
  initial,
  avatarUrl,
  username,
  memberSince,
  savedCents,
  skippedCount,
  boughtCount,
  coolingCount,
  skipRatePct,
  groupsCount,
  streakDays,
  biggestSaveCents,
  biggestSaveTitle,
  avgSaveCents,
  lifeHours,
  milestones,
  mostSkipped,
  quarterSavedCents,
  quarterSkippedCount,
  quarterVsPrevPct,
  notifyCoolingReady: initCooling,
  notifyGroupActivity: initGroup,
  notifyMilestoneUnlocked: initMilestone,
  recentActivity,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Notification toggles — optimistic local state, persisted via server action
  const [notifyCooling, setNotifyCooling] = useState(initCooling)
  const [notifyGroup, setNotifyGroup] = useState(initGroup)
  const [notifyMilestone, setNotifyMilestone] = useState(initMilestone)
  const [, startNotifTransition] = useTransition()
  const fmt = useFmt()

  function saveNotifs(next: { cooling: boolean; group: boolean; milestone: boolean }) {
    const fd = new FormData()
    fd.set('notifyCoolingReady', next.cooling ? '1' : '0')
    fd.set('notifyGroupActivity', next.group ? '1' : '0')
    fd.set('notifyMilestoneUnlocked', next.milestone ? '1' : '0')
    startNotifTransition(() => { updateNotificationPrefs(fd) })
  }

  function toggleCooling() {
    const next = !notifyCooling
    setNotifyCooling(next)
    saveNotifs({ cooling: next, group: notifyGroup, milestone: notifyMilestone })
  }
  function toggleGroup() {
    const next = !notifyGroup
    setNotifyGroup(next)
    saveNotifs({ cooling: notifyCooling, group: next, milestone: notifyMilestone })
  }
  function toggleMilestone() {
    const next = !notifyMilestone
    setNotifyMilestone(next)
    saveNotifs({ cooling: notifyCooling, group: notifyGroup, milestone: next })
  }

  return (
    <div className="pb-8 lg:pb-16">
      {/* ═══ HERO BANNER ═══ */}
      <div className="relative">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary-deep to-[#18403D]" />
          <div className="absolute -top-44 -right-24 w-[540px] h-[540px] rounded-full bg-[radial-gradient(circle,_rgba(201,169,97,0.22),_transparent_65%)]" />
          <div className="absolute -bottom-48 -left-28 w-[440px] h-[440px] rounded-full bg-[radial-gradient(circle,_rgba(255,255,255,0.06),_transparent_65%)]" />
          <div
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'radial-gradient(rgba(255,255,255,0.4) 0.6px, transparent 0.6px)',
              backgroundSize: '14px 14px',
            }}
          />

          <div className="relative z-[1] px-5 lg:px-12 pt-6 lg:pt-12 pb-16 lg:pb-[56px]">
            <Link
              href="/dashboard"
              className="lg:hidden inline-flex items-center gap-1.5 mb-4 min-h-11 -ml-1 pl-1 pr-2 text-xs font-medium text-white/60 hover:text-white/80 transition-colors"
            >
              <ArrowLeft size={16} strokeWidth={2} />
              Dashboard
            </Link>

            <div className="flex items-start gap-4 lg:gap-8">
              <div className="relative flex-shrink-0">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={name}
                    width={132}
                    height={132}
                    sizes="(min-width: 1024px) 132px, 80px"
                    className="w-20 h-20 lg:w-[132px] lg:h-[132px] rounded-full object-cover shadow-avatar-hero"
                  />
                ) : (
                  <div className="w-20 h-20 lg:w-[132px] lg:h-[132px] rounded-full bg-gradient-to-br from-gold to-gold-deep text-white flex items-center justify-center font-display text-4xl lg:text-display-2xl font-medium shadow-avatar-hero tracking-tight">
                    {initial}
                  </div>
                )}
                <div className="absolute bottom-1 right-1 lg:bottom-2 lg:right-2 w-4 h-4 lg:w-[22px] lg:h-[22px] rounded-full bg-online shadow-[0_0_0_3px_var(--primary-deep)] lg:shadow-[0_0_0_4px_var(--primary-deep)]" />
              </div>

              <div className="flex-1 min-w-0 text-white">
                <p className="text-[11px] font-semibold text-white/55 uppercase tracking-[1.4px]">
                  Member since {fmtMemberSince(memberSince)}
                </p>
                <div className="flex items-baseline gap-2 lg:gap-3.5 mt-1.5 lg:mt-1 flex-wrap">
                  <h1 className="font-display text-3xl lg:text-display-xl font-medium tracking-tight lg:tracking-[-1.8px] leading-tight">
                    {name}
                  </h1>
                  {milestones.count > 0 && (
                    <span className="hidden lg:inline font-display italic text-xl lg:text-display-md text-gold tracking-tight">
                      · {milestones.count} milestone{milestones.count !== 1 ? 's' : ''} unlocked
                    </span>
                  )}
                </div>
                {username && (
                  <p className="mt-1.5 text-sm text-white/55">@{username}</p>
                )}

                <div className="hidden lg:flex items-center gap-4 mt-4 text-label text-white/65 flex-wrap">
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" />
                      <circle cx="12" cy="7" r="4" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" />
                    </svg>
                    {email}
                  </span>
                  <span className="w-[3px] h-[3px] rounded-full bg-white/30" />
                  <span className="inline-flex items-center gap-1.5">
                    <Users size={14} strokeWidth={1.7} className="text-white/55" />
                    {groupsCount} {groupsCount === 1 ? 'group' : 'groups'}
                  </span>
                  {streakDays > 0 && (
                    <>
                      <span className="w-[3px] h-[3px] rounded-full bg-white/30" />
                      <span className="inline-flex items-center gap-1.5">
                        🔥 {streakDays}-day streak
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="hidden lg:flex flex-col gap-2.5 items-end">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="h-11 px-[18px] rounded-xl bg-white/[0.14] backdrop-blur-sm text-white text-label font-semibold inline-flex items-center gap-2 hover:bg-white/[0.22] transition-colors"
                >
                  <Pencil size={14} strokeWidth={1.8} />
                  Edit profile
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setEditing(true)}
              className="lg:hidden mt-5 inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-white/[0.14] backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/[0.22] transition-colors"
            >
              <Pencil size={14} strokeWidth={1.8} />
              Edit profile
            </button>
          </div>
        </div>

        {/* ═══ STAT STRIP ═══ */}
        <div className="relative z-[2] mx-5 lg:mx-12 -mt-10 bg-card rounded-2xl shadow-pop overflow-hidden">
          <div className="grid grid-cols-2 lg:grid-cols-5">
            <StatCell
              label="Saved by waiting"
              value={
                <>
                  <span className="text-lg lg:text-display-sm text-primary tracking-tight">RM </span>
                  {(savedCents / 100).toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                </>
              }
              accent="primary"
              border
            />
            <StatCell label="Items skipped" value={skippedCount} accent="text" border />
            <StatCell label="Skip rate" value={`${skipRatePct}%`} accent="text" border />
            <StatCell
              label="Day streak"
              value={streakDays > 0 ? `🔥 ${streakDays}` : '—'}
              accent="gold"
              border
            />
            <StatCell
              label="Hours reclaimed"
              value={lifeHours != null ? fmtHours(lifeHours) : '—'}
              accent="gold"
              className="col-span-2 lg:col-span-1 border-t border-sep lg:border-t-0"
            />
          </div>
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="px-5 lg:px-12 pt-8 lg:pt-10">
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6 lg:gap-8">
          {/* LEFT COLUMN */}
          <div className="space-y-8">
            <section>
              <h2 className="mb-4 font-display text-2xl font-medium tracking-tight text-foreground">
                Personal records
              </h2>
              <Card padding="none">
                <RecordRow
                  label="Biggest single skip"
                  value={biggestSaveCents > 0 ? fmt(biggestSaveCents, 0) : '—'}
                  caption={biggestSaveTitle}
                  accent="primary"
                />
                <RecordRow
                  label="Average save"
                  value={avgSaveCents > 0 ? fmt(avgSaveCents, 0) : '—'}
                  caption={`Across ${skippedCount} skipped items`}
                  accent="text"
                />
                <RecordRow
                  label="Total decisions"
                  value={skippedCount + boughtCount}
                  caption={`${coolingCount} still cooling`}
                  accent="gold"
                  last
                />
              </Card>
            </section>

            {/* Milestones — real data */}
            <section id="milestones">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">
                  Milestones
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {milestones.count}/{milestones.total}
                  </span>
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {milestones.all.map(m => (
                  <MilestoneCard key={m.id} milestone={m} />
                ))}
              </div>
            </section>

            {/* Most Skipped — real category data */}
            <section>
              <h2 className="mb-4 font-display text-2xl font-medium tracking-tight text-foreground">
                Most skipped
              </h2>
              <Card padding="md">
                {mostSkipped.length === 0 ? (
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary-tint text-primary-deep flex items-center justify-center flex-shrink-0">
                      <Tag size={16} strokeWidth={1.8} />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed pt-2">
                      Skip some temptations to see your category breakdown here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {mostSkipped.map(r => (
                      <div key={r.id} className="space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="text-label font-semibold text-foreground">{r.label}</span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {r.count} item{r.count !== 1 ? 's' : ''} · {r.pct}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${r.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </section>

            {/* This Quarter — real data */}
            <section>
              <h2 className="mb-4 font-display text-2xl font-medium tracking-tight text-foreground">
                This quarter
              </h2>
              <Card padding="md">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gold-tint text-gold-deep flex items-center justify-center flex-shrink-0">
                    <CalendarRange size={16} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Your last 90 days at a glance.
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <QuarterCell label="Saved" value={fmt(quarterSavedCents, 0)} tone="primary" />
                      <QuarterCell label="Skipped" value={String(quarterSkippedCount)} tone="text" />
                      <QuarterCell
                        label="vs prev"
                        value={quarterVsPrevPct !== null ? `${quarterVsPrevPct > 0 ? '+' : ''}${quarterVsPrevPct}%` : '—'}
                        tone="gold"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </section>

            <section className="lg:hidden">
              <Card padding="none">
                <div className="px-5 py-4 flex items-center gap-3 border-b border-sep">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="var(--text-muted)" strokeWidth="1.7" strokeLinecap="round" />
                    <circle cx="12" cy="7" r="4" stroke="var(--text-muted)" strokeWidth="1.7" />
                  </svg>
                  <span className="text-sm text-muted-foreground">{email}</span>
                </div>
                <div className="px-5 py-4 flex items-center gap-3">
                  <Users size={16} strokeWidth={1.7} className="text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {groupsCount} {groupsCount === 1 ? 'group' : 'groups'}
                  </span>
                </div>
              </Card>
            </section>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-8">
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">
                  Recent activity
                </h2>
                <Link
                  href="/cooling"
                  className="text-label font-semibold text-primary inline-flex items-center gap-1 hover:underline"
                >
                  See all <ArrowRight size={14} strokeWidth={2} />
                </Link>
              </div>
              <Card padding="none">
                {recentActivity.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No activity yet. Start logging temptations!
                  </div>
                ) : (
                  recentActivity.map((item, i) => {
                    const isSaved = item.status === 'SKIPPED'
                    const isLast = i === recentActivity.length - 1
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex items-start gap-3.5 px-5 py-4',
                          !isLast && 'border-b border-sep',
                        )}
                      >
                        <div
                          className={cn(
                            'flex-shrink-0 w-[34px] h-[34px] rounded-sm flex items-center justify-center',
                            isSaved ? 'bg-gold-tint text-gold-deep' : 'bg-coral-tint text-coral-deep',
                          )}
                        >
                          {isSaved ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M5 8h14l-1 12H6L5 8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                              <path d="M9 8V6a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-label font-semibold text-foreground truncate">
                            {isSaved ? 'Skipped' : 'Bought'} {item.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {isSaved ? 'Saved' : 'Spent'} {fmt(item.amountCents, 0)}
                          </p>
                        </div>
                        <span className="text-[11px] text-subtle-foreground font-medium whitespace-nowrap">
                          {relativeTime(item.resolvedAt)}
                        </span>
                      </div>
                    )
                  })
                )}
              </Card>
            </section>

            {/* Notifications — functional (in-app only) */}
            <section>
              <h2 className="mb-4 font-display text-2xl font-medium tracking-tight text-foreground">
                Notifications
              </h2>
              <Card padding="none">
                <NotificationToggle
                  label="Cooling ready"
                  caption="Gentle ping when a temptation hits its timer"
                  checked={notifyCooling}
                  onToggle={toggleCooling}
                />
                <NotificationToggle
                  label="Group activity"
                  caption="When someone adds an expense or invites you"
                  checked={notifyGroup}
                  onToggle={toggleGroup}
                />
                <NotificationToggle
                  label="Milestone unlocked"
                  caption="Celebrate when you cross a savings threshold"
                  checked={notifyMilestone}
                  onToggle={toggleMilestone}
                  last
                />
              </Card>
            </section>

            {/* Data */}
            <section>
              <h2 className="mb-4 font-display text-2xl font-medium tracking-tight text-foreground">
                Data
              </h2>
              <Card padding="none">
                <a
                  href="/api/export/csv"
                  download
                  className="w-full flex items-center gap-3.5 px-5 py-4 min-h-[60px] text-left hover:bg-foreground/[0.025] transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary-tint text-primary-deep flex items-center justify-center flex-shrink-0">
                    <Download size={16} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-label font-semibold text-foreground">Export as CSV</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Download every cooling item, skip, buy, and group expense
                    </p>
                  </div>
                  <ChevronRight size={14} strokeWidth={1.8} className="text-subtle-foreground flex-shrink-0" />
                </a>
              </Card>
            </section>

            {/* Account */}
            <section>
              <h2 className="mb-4 font-display text-2xl font-medium tracking-tight text-foreground">
                Account
              </h2>
              <Card padding="none">
                <Link
                  href="/settings"
                  className="flex items-center gap-3.5 px-5 py-4 min-h-[60px] border-b border-sep hover:bg-foreground/[0.025] transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-label font-semibold text-foreground">Income settings</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Calibrate the &ldquo;hours of your life&rdquo; lens
                    </p>
                  </div>
                  <ChevronRight size={14} strokeWidth={1.8} className="text-subtle-foreground flex-shrink-0" />
                </Link>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="w-full flex items-center gap-3.5 px-5 py-4 min-h-[60px] border-b border-sep text-left hover:bg-foreground/[0.025] transition-colors"
                  >
                    <div className="flex-1">
                      <p className="text-label font-semibold text-foreground">Log out</p>
                      <p className="text-xs text-muted-foreground mt-0.5">On this device</p>
                    </div>
                    <LogOut size={14} strokeWidth={1.8} className="text-subtle-foreground flex-shrink-0" />
                  </button>
                </form>
                <button
                  type="button"
                  className="w-full flex items-center gap-3.5 px-5 py-4 min-h-[60px] text-left hover:bg-foreground/[0.025] transition-colors"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <div className="flex-1">
                    <p className="text-label font-semibold text-coral-deep">Delete account</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Permanently remove your data
                    </p>
                  </div>
                  <ChevronRight size={14} strokeWidth={1.8} className="text-coral-deep flex-shrink-0" />
                </button>
              </Card>
              {deleteError && (
                <p className="mt-2 text-sm text-coral-deep">{deleteError}</p>
              )}
            </section>
          </div>
        </div>
      </div>

      <footer className="mt-8 pb-2 text-center text-xs text-subtle-foreground">
        Made with love by{' '}
        <a
          href="https://moaazexe.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-muted-foreground transition-colors"
        >
          Moaaz
        </a>
      </footer>

      {editing && (
        <EditProfileSheet
          initialName={name}
          initialAvatarUrl={avatarUrl}
          email={email}
          initialUsername={username}
          onClose={() => setEditing(false)}
        />
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete your account?"
        description="This permanently removes your account, every cooling item, and every expense you've recorded. Group members will see your name swap to 'Removed user'."
        confirmLabel="Delete account"
        destructive
        requireText="DELETE"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={async () => {
          setConfirmingDelete(false)
          const err = await deleteAccount()
          if (err) setDeleteError(err)
        }}
      />
    </div>
  )
}

/* ─── Notification toggle ─── */

function NotificationToggle({
  label,
  caption,
  checked,
  onToggle,
  last,
}: {
  label: string
  caption: string
  checked: boolean
  onToggle: () => void
  last?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-3.5 px-5 py-4 min-h-[60px] text-left hover:bg-foreground/[0.025] transition-colors',
        !last && 'border-b border-sep',
      )}
    >
      <div className="w-9 h-9 rounded-lg bg-primary-tint text-primary-deep flex items-center justify-center flex-shrink-0">
        <Bell size={16} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-label font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>
      </div>
      <span
        role="switch"
        aria-checked={checked}
        className={cn(
          'relative flex-shrink-0 w-11 h-6 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

/* ─── Stat strip cell ─── */

function StatCell({
  label,
  value,
  accent,
  border,
  className,
}: {
  label: string
  value: React.ReactNode
  accent: 'primary' | 'text' | 'gold'
  border?: boolean
  className?: string
}) {
  const colorClass =
    accent === 'primary' ? 'text-primary' : accent === 'gold' ? 'text-gold-deep' : 'text-foreground'

  return (
    <div className={cn('px-5 lg:px-6 py-5', border && 'border-r border-sep', className)}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[1.2px]">{label}</p>
      <p className={cn('font-display text-2xl lg:text-display-lg font-medium tracking-tight tabular-nums leading-tight mt-1.5', colorClass)}>
        {value}
      </p>
    </div>
  )
}

/* ─── Record row ─── */

function RecordRow({
  label,
  value,
  caption,
  accent = 'text',
  last,
}: {
  label: string
  value: React.ReactNode
  caption: string
  accent?: 'primary' | 'text' | 'gold'
  last?: boolean
}) {
  const colorClass =
    accent === 'primary' ? 'text-primary' : accent === 'gold' ? 'text-gold-deep' : 'text-foreground'

  return (
    <div className={cn('flex items-center gap-4 lg:gap-5 px-5 lg:px-[22px] py-[18px]', !last && 'border-b border-sep')}>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[1px]">{label}</p>
        <p className="text-label text-muted-foreground mt-1.5 italic">{caption}</p>
      </div>
      <span className={cn('font-display text-display-md lg:text-3xl font-medium tracking-tight tabular-nums flex-shrink-0', colorClass)}>
        {value}
      </span>
    </div>
  )
}

/* ─── Quarter cell ─── */

function QuarterCell({ label, value, tone }: { label: string; value: string; tone: 'primary' | 'gold' | 'text' }) {
  const colorClass =
    tone === 'primary' ? 'text-primary' : tone === 'gold' ? 'text-gold-deep' : 'text-foreground'
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-display text-lg font-medium tabular-nums tracking-tight', colorClass)}>{value}</p>
    </div>
  )
}
