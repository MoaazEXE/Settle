import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { usersRepo } from '@/data/users.repo'
import { CurrencyProvider } from '@/lib/currency-context'
import { ONBOARDING_REQUIRED_FROM } from '@/lib/constants'
import { LogModalProvider } from './_components/log-modal-context'
import { ResolveSheetProvider } from './_components/resolve-sheet-context'
import { NavData } from './_components/nav-data'
import { NavSkeleton } from './_components/nav-skeleton'
import { TopBarData } from './_components/top-bar-data'
import { TopBarSkeleton } from './_components/top-bar-skeleton'
import { LogSheetData } from './_components/log-sheet-data'
import { ResolveSheetData } from './_components/resolve-sheet-data'
import { LogFab } from './_components/log-fab'
import { AppRealtimeData } from './_components/app-realtime-data'

/**
 * Layout pays for ONE thing only — a cookie-local auth check (no DB).
 * Everything else streams in via Suspense so the route-segment shell
 * paints immediately on every navigation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) {
    // Clear stale session cookie — if the cookie exists but the session is invalid,
    // the proxy would loop: /login → /dashboard → /login → ... endlessly.
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  // Read DB row for currency + onboarding gate
  const dbUser = await usersRepo.findById(user.id)
  if (!dbUser) {
    // No DB row — sign out to break any potential redirect loop for stale sessions
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  // Prefer DB name (user-editable) over OAuth metadata (overwritten by Google on each login)
  const metaName = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : null
  const name = dbUser.name ?? metaName ?? user.email?.split('@')[0] ?? 'You'
  const initial = name.charAt(0).toUpperCase()
  // Users created before the onboarding feature launched are grandfathered in.
  // Only redirect new users (created after the launch date) who haven't completed it.
  if (!dbUser.onboardingCompletedAt && dbUser.createdAt >= ONBOARDING_REQUIRED_FROM) {
    redirect('/onboarding')
  }
  const currency = dbUser.currency

  return (
    <CurrencyProvider currency={currency}>
    <LogModalProvider>
      <ResolveSheetProvider>
        <div className="min-h-screen flex flex-col lg:flex-row bg-background">
          <Suspense
            fallback={<NavSkeleton name={name} email={user.email ?? ''} initial={initial} />}
          >
            <NavData />
          </Suspense>
          <div className="flex-1 min-w-0 flex flex-col">
            <Suspense fallback={<TopBarSkeleton initial={initial} />}>
              <TopBarData initial={initial} />
            </Suspense>
            <main className="flex-1 mb-[60px] lg:mb-0">{children}</main>
          </div>
        </div>

        <LogFab />

        {/* Sheets are invisible until opened — stream in lazily without blocking. */}
        <Suspense fallback={null}>
          <LogSheetData />
        </Suspense>
        <Suspense fallback={null}>
          <ResolveSheetData />
        </Suspense>

        {/* App-wide realtime — keeps the bell, dashboard, cooling & groups live. */}
        <Suspense fallback={null}>
          <AppRealtimeData />
        </Suspense>
      </ResolveSheetProvider>
    </LogModalProvider>
    </CurrencyProvider>
  )
}
