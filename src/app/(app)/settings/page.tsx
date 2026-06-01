import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { redirect } from 'next/navigation'
import { usersRepo } from '@/data/users.repo'
import { getUserContext } from '@/lib/user-context'
import { SettingsForm } from './_components/settings-form'
import { DEFAULT_CURRENCY } from '@/lib/constants'

export default async function SettingsPage() {
  const ctx = await getUserContext()
  if (!ctx) redirect('/login')

  const dbUser = await usersRepo.findById(ctx.id)

  return (
    <div className="max-w-[920px] mx-auto px-5 pt-4 pb-12 lg:px-12 lg:pt-10">
      <Link
        href="/dashboard"
        className="lg:hidden inline-flex items-center gap-1.5 mb-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} strokeWidth={2} />
        Dashboard
      </Link>

      <header className="mb-7 lg:mb-9">
        <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-foreground">Income</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Calibrate the &ldquo;hours of your life&rdquo; lens.
        </p>
      </header>

      <div className="rounded-card bg-card p-5 lg:p-8 shadow-card">
        <SettingsForm
          initial={{
            monthlyIncomeCents: dbUser?.monthlyIncomeCents ?? null,
            workingHoursPerWeek: dbUser?.workingHoursPerWeek ?? null,
            timeCostMode: dbUser?.timeCostMode ?? 'SIMPLE',
            commuteHours: dbUser?.commuteHours ?? null,
            workCostsCents: dbUser?.workCostsCents ?? null,
            currency: dbUser?.currency ?? DEFAULT_CURRENCY,
          }}
        />
      </div>
    </div>
  )
}
