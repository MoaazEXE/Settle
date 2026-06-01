import { createClient } from '@/lib/supabase/server'
import { ensureUserRecord, AccountEmailCollisionError } from '@/lib/ensure-user'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/dashboard'
  // Reject open redirects: only allow same-origin paths (no // or \)
  const next = /^\/(?![/\\])/.test(rawNext) ? rawNext : '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=Missing+auth+code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error)
    return NextResponse.redirect(`${origin}/login?error=Could+not+authenticate`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    try {
      await ensureUserRecord(user)
    } catch (e) {
      if (e instanceof AccountEmailCollisionError) {
        // Sign the user out so the unverified provider session doesn't persist,
        // then bounce back to /login with a clear error.
        await supabase.auth.signOut().catch(() => {})
        const params = new URLSearchParams({ error: e.message })
        return NextResponse.redirect(`${origin}/login?${params.toString()}`)
      }
      console.error('[auth/callback] ensureUserRecord failed:', e)
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
