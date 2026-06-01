'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ensureUserRecord, AccountEmailCollisionError } from '@/lib/ensure-user'
import { consume } from '@/lib/rate-limit'

async function getClientIp(): Promise<string> {
  const hdrs = await headers()
  return (hdrs.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'anon'
}

export async function signIn(
  prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const email = formData.get('email')
  const password = formData.get('password')
  if (typeof email !== 'string' || typeof password !== 'string') {
    return 'Invalid form submission.'
  }

  const ip = await getClientIp()
  const ok = await consume(`signIn:${ip}`, 10, 600).catch(() => true)
  if (!ok) return 'Too many login attempts — try again in 10 minutes.'

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return error.message

  try {
    if (data.user) await ensureUserRecord(data.user)
  } catch (e) {
    if (e instanceof AccountEmailCollisionError) {
      await supabase.auth.signOut().catch(() => {})
      return e.message
    }
    // Other failures are non-fatal: row may already exist or will be created on next request
  }

  redirect('/dashboard')
}

export async function signUp(
  prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const name = formData.get('name')
  const email = formData.get('email')
  const password = formData.get('password')
  if (
    typeof name !== 'string' ||
    typeof email !== 'string' ||
    typeof password !== 'string'
  ) {
    return 'Invalid form submission.'
  }

  const ip = await getClientIp()
  const ok = await consume(`signUp:${ip}`, 10, 600).catch(() => true)
  if (!ok) return 'Too many attempts from this network — try again in 10 minutes.'

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  })
  if (error) return error.message

  // Email confirmation disabled — user is signed in immediately
  if (data.session && data.user) {
    try {
      await ensureUserRecord(data.user)
    } catch (e) {
      if (e instanceof AccountEmailCollisionError) {
        await supabase.auth.signOut().catch(() => {})
        return e.message
      }
      // Other failures are non-fatal
    }
    redirect('/dashboard')
  }

  return 'check-email'
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function deleteAccount(): Promise<string | null> {
  let userId: string

  // Step 1: verify auth and service-role key — fail fast before touching anything
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return 'Account deletion is not configured. Contact support.'

  try {
    const { getCurrentUser } = await import('@/lib/supabase/server')
    const user = await getCurrentUser()
    if (!user) return 'Not authenticated.'
    userId = user.id
  } catch (err) {
    const { logError } = await import('@/lib/log-error')
    await logError('action:deleteAccount:verify', {}, err)
    return 'Not authenticated.'
  }

  // Step 2: delete the DB row — the only critical step
  try {
    const { usersRepo } = await import('@/data/users.repo')
    await usersRepo.cascadeDeleteUserData(userId)
  } catch (err) {
    const { logError } = await import('@/lib/log-error')
    await logError('action:deleteAccount:prisma', { userId }, err)
    return 'Failed to delete account. Please try again.'
  }

  // Steps 3-5 are best-effort — don't let them block the redirect
  const supabase = await createClient()

  await supabase.storage
    .from('avatars')
    .remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.jpeg`, `${userId}/avatar.webp`])
    .catch(() => {})

  await supabase.auth.signOut().catch(() => {})

  try {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js')
    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)
    await admin.auth.admin.deleteUser(userId)
  } catch (err) {
    const { logError } = await import('@/lib/log-error')
    await logError('action:deleteAccount:authDelete', { userId }, err)
  }

  redirect('/')
}
