import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { usersRepo } from '@/data/users.repo'
import type { TimeCostInput } from '@/types'
import { DEFAULT_CURRENCY, DEFAULT_COOLING_PERIOD } from '@/lib/constants'

export type TimeCostContext = Omit<TimeCostInput, 'amountCents'>

export interface UserContext {
  id: string
  name: string
  email: string
  initial: string
  avatarUrl: string | null
  username: string | null
  usernameUpdatedAt: Date | null
  defaultCoolingPeriod: string
  currency: string
  timeCostContext: TimeCostContext | null
}

/**
 * Per-request cached identity + DB profile. Combines Supabase JWT claims and
 * the Prisma user row so every consumer in a single render gets one read.
 */
export const getUserContext = cache(async (): Promise<UserContext | null> => {
  const authUser = await getCurrentUser()
  if (!authUser) return null

  const dbUser = await usersRepo.findById(authUser.id)
  const metadataName =
    typeof authUser.user_metadata?.name === 'string'
      ? (authUser.user_metadata.name as string)
      : null
  // Prefer DB name (user-editable) over OAuth metadata (overwritten by Google on each login)
  const name = dbUser?.name ?? metadataName ?? authUser.email?.split('@')[0] ?? 'You'

  const timeCostContext: TimeCostContext | null =
    dbUser?.monthlyIncomeCents && dbUser.workingHoursPerWeek
      ? {
          monthlyIncomeCents: dbUser.monthlyIncomeCents,
          workingHoursPerWeek: dbUser.workingHoursPerWeek,
          mode: dbUser.timeCostMode,
          commuteHours: dbUser.commuteHours ?? undefined,
          workCostsCents: dbUser.workCostsCents ?? undefined,
        }
      : null

  return {
    id: authUser.id,
    name,
    email: authUser.email ?? '',
    initial: (name || '?').charAt(0).toUpperCase(),
    avatarUrl: dbUser?.avatarUrl ?? null,
    username: dbUser?.username ?? null,
    usernameUpdatedAt: dbUser?.usernameUpdatedAt ?? null,
    defaultCoolingPeriod: dbUser?.defaultCoolingPeriod ?? DEFAULT_COOLING_PERIOD,
    currency: dbUser?.currency ?? DEFAULT_CURRENCY,
    timeCostContext,
  }
})

/**
 * Redirect to /onboarding if the user hasn't completed the onboarding flow.
 * Call this inside protected server components when you need a per-page gate
 * in addition to the layout-level check.
 */
export async function requireOnboardingComplete(): Promise<void> {
  const authUser = await getCurrentUser()
  if (!authUser) return
  const dbUser = await usersRepo.findById(authUser.id)
  if (!dbUser?.onboardingCompletedAt) redirect('/onboarding')
}
