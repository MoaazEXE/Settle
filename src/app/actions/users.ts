'use server'

import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { getCurrentUser } from '@/lib/supabase/server'
import { usersRepo } from '@/data/users.repo'
import {
  getCents,
  getOptionalNumber,
  getRequiredString,
  getString,
  ValidationError,
  withValidation,
} from '@/lib/form-data'
import { guard, consume } from '@/lib/rate-limit'
import { validateUsername, normalizeUsername } from '@/lib/username'
import type { TimeCostMode } from '@/types'
import { CURRENCIES, type CurrencyCode } from '@/lib/formatters'
import { DEFAULT_CURRENCY } from '@/lib/constants'

const VALID_CURRENCIES: Set<string> = new Set(CURRENCIES.map(c => c.code))

export async function updateProfile(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await withValidation(async () => {
    const user = await getCurrentUser()
    if (!user) throw new ValidationError('Unauthorized')

    // Guarantee the DB row exists — Google OAuth users may have a valid session
    // but no Prisma row if ensureUserRecord failed silently in the auth callback.
    const { ensureUserRecord } = await import('@/lib/ensure-user')
    await ensureUserRecord(user).catch(() => {})

    const name = getRequiredString(formData, 'name')
    if (name.length > 60) throw new ValidationError('Name is too long (60 max).')

    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()

    // Avatar upload — uses service-role client to bypass bucket RLS on the server
    const avatarFile = formData.get('avatar')
    let avatarUrl: string | undefined
    if (avatarFile instanceof File && avatarFile.size > 0) {
      if (avatarFile.size > 2 * 1024 * 1024) throw new ValidationError('Avatar must be under 2 MB.')
      await guard(`uploadAvatar:${user.id}`, 5, 3600)

      // Validate file type by magic bytes (not just extension or Content-Type header)
      const header = new Uint8Array(await avatarFile.slice(0, 12).arrayBuffer())
      const isJpeg = header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF
      const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47
      const isWebp = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
        && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
      if (!isJpeg && !isPng && !isWebp) throw new ValidationError('Avatar must be a JPEG, PNG, or WebP image.')
      const detectedType = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp'
      const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp'

      const path = `${user.id}/avatar.${ext}`

      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!serviceKey) throw new ValidationError('Storage is not configured.')
      const { createClient: createAdmin } = await import('@supabase/supabase-js')
      const adminStorage = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

      // Remove any old avatar files before uploading
      await adminStorage.storage
        .from('avatars')
        .remove([`${user.id}/avatar.jpg`, `${user.id}/avatar.png`, `${user.id}/avatar.jpeg`, `${user.id}/avatar.webp`])
        .catch(() => {})

      const { error } = await adminStorage.storage
        .from('avatars')
        .upload(path, avatarFile, { upsert: true, contentType: detectedType })
      if (error) throw new ValidationError(`Upload failed: ${error.message}`)

      const { data } = adminStorage.storage.from('avatars').getPublicUrl(path)
      // Append version param so browsers fetch the new image instead of serving cache
      avatarUrl = `${data.publicUrl}?v=${Date.now()}`
    }

    // Update Prisma row and Supabase user_metadata in parallel.
    // getUserContext reads name from user_metadata, so both must be in sync.
    await Promise.all([
      usersRepo.updateProfile(user.id, { name, ...(avatarUrl && { avatarUrl }) }),
      supabase.auth.updateUser({ data: { name } }),
    ])

    updateTag(`user-${user.id}`)
  }, 'action:updateProfile')

  return typeof result === 'string' ? result : null
}

export async function updateNotificationPrefs(formData: FormData): Promise<void> {
  const user = await getCurrentUser()
  if (!user) return

  await usersRepo.updateNotificationPrefs(user.id, {
    notifyCoolingReady: formData.get('notifyCoolingReady') === '1',
    notifyGroupActivity: formData.get('notifyGroupActivity') === '1',
    notifyMilestoneUnlocked: formData.get('notifyMilestoneUnlocked') === '1',
  })

  updateTag(`user-${user.id}`)
}

export async function checkUsernameAvailable(username: string): Promise<{ available: boolean; reason?: string }> {
  const normalized = normalizeUsername(username)
  const validation = validateUsername(normalized)
  if (!validation.ok) return { available: false, reason: validation.reason }
  const existing = await usersRepo.findByUsername(normalized)
  if (existing) return { available: false, reason: 'Username is already taken.' }
  return { available: true }
}

export async function completeOnboarding(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await withValidation(async () => {
    const user = await getCurrentUser()
    if (!user) throw new ValidationError('Unauthorized')

    const dbUser = await usersRepo.findById(user.id)
    if (dbUser?.onboardingCompletedAt) redirect('/dashboard')

    const rawUsername = getRequiredString(formData, 'username')
    const username = normalizeUsername(rawUsername)
    const validation = validateUsername(username)
    if (!validation.ok) throw new ValidationError(validation.reason)

    // Race-condition guard: re-check availability at submit time
    const existing = await usersRepo.findByUsername(username)
    if (existing && existing.id !== user.id) throw new ValidationError('Username was just taken — please choose another.')

    const currency = getString(formData, 'currency') ?? DEFAULT_CURRENCY
    if (!VALID_CURRENCIES.has(currency)) throw new ValidationError('Invalid currency.')

    const monthlyIncomeCents = getCents(formData, 'monthlyIncome')
    const workingHoursPerWeek = getOptionalNumber(formData, 'weeklyHours')

    if (monthlyIncomeCents !== null && monthlyIncomeCents <= 0) {
      throw new ValidationError('Income must be a positive number.')
    }
    if (workingHoursPerWeek !== null && workingHoursPerWeek <= 0) {
      throw new ValidationError('Working hours must be a positive number.')
    }

    await usersRepo.completeOnboarding(user.id, {
      username,
      currency,
      monthlyIncomeCents,
      workingHoursPerWeek,
    })

    updateTag(`user-${user.id}`)
  })

  if (typeof result === 'string') return result
  redirect('/dashboard')
}

export async function updateUsername(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await withValidation(async () => {
    const user = await getCurrentUser()
    if (!user) throw new ValidationError('Unauthorized')

    const dbUser = await usersRepo.findById(user.id)
    if (!dbUser) throw new ValidationError('User not found.')

    const rawUsername = getRequiredString(formData, 'username')
    const username = normalizeUsername(rawUsername)
    const validation = validateUsername(username)
    if (!validation.ok) throw new ValidationError(validation.reason)

    if (username === dbUser.usernameLower) throw new ValidationError('That is already your username.')

    await consume(`updateUsername:${user.id}`, 5, 3600)

    const existing = await usersRepo.findByUsername(username)
    if (existing) throw new ValidationError('Username is already taken.')

    await usersRepo.updateUsername(user.id, username)
    updateTag(`user-${user.id}`)
  })

  return typeof result === 'string' ? result : null
}

export async function saveIncomeSettings(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await withValidation(async () => {
    const user = await getCurrentUser()
    if (!user) throw new ValidationError('Unauthorized')

    const monthlyIncomeCents = getCents(formData, 'monthlyIncome')
    const workingHoursPerWeek = getOptionalNumber(formData, 'weeklyHours')
    const timeCostMode = (getString(formData, 'timeCostMode') === 'TRUE_HOURLY'
      ? 'TRUE_HOURLY'
      : 'SIMPLE') as TimeCostMode

    if (monthlyIncomeCents !== null && monthlyIncomeCents <= 0) {
      throw new ValidationError('Income must be a positive number.')
    }
    if (workingHoursPerWeek !== null && workingHoursPerWeek <= 0) {
      throw new ValidationError('Working hours must be a positive number.')
    }

    const currency = getString(formData, 'currency') ?? DEFAULT_CURRENCY
    if (!VALID_CURRENCIES.has(currency)) throw new ValidationError('Invalid currency.')

    await Promise.all([
      usersRepo.updateIncome(user.id, {
        monthlyIncomeCents,
        workingHoursPerWeek,
        timeCostMode,
        commuteHours: getOptionalNumber(formData, 'commuteHours'),
        workCostsCents: getCents(formData, 'workCosts'),
      }),
      usersRepo.updateCurrency(user.id, currency as CurrencyCode),
    ])

    updateTag(`user-${user.id}`)
  })

  return typeof result === 'string' ? result : null
}
