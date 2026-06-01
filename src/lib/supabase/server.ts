import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'

/**
 * Server-side Supabase client — use in Server Components, Server Actions, Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component where cookies can't be set — safe to ignore
          }
        },
      },
    }
  )
}

export interface AuthUser {
  id: string
  email: string | undefined
  user_metadata: Record<string, unknown> | undefined
}

/**
 * Per-request cached lookup of the authenticated user.
 *
 * ─ Security boundary ─
 * This is THE authentication boundary for the app. Every server action and
 * server component must derive identity from this function (or one wrapping
 * it) — never trust an id passed in from the client. The proxy in `proxy.ts`
 * is a UX optimization that gates routes by cookie presence; it does not
 * verify anything cryptographically.
 *
 * Implementation: calls `supabase.auth.getUser()` which contacts Supabase Auth
 * to validate the JWT (so revoked sessions and forged cookies are rejected).
 * Wrapped in React `cache()` so the network cost is paid at most once per
 * request, regardless of how many components call it.
 *
 * Prisma queries run as the Postgres owner and bypass RLS, so the RLS
 * policies are defense in depth only — application-layer guards built on top
 * of this function are the real enforcement.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata,
  }
})

/**
 * Alias kept for callers that previously distinguished "strict" verification.
 * Now identical to `getCurrentUser` — both go through `getUser()`.
 */
export const verifyAuthUser = getCurrentUser
