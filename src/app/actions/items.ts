'use server'

import { updateTag } from 'next/cache'
import { getCurrentUser } from '@/lib/supabase/server'
import { itemsRepo } from '@/data/items.repo'
import { usersRepo } from '@/data/users.repo'
import { ensureUserRecord } from '@/lib/ensure-user'
import { computeCoolingUntil } from '@/core/cooling/coolingState'
import {
  getRequiredString,
  getString,
  getRequiredCents,
  ValidationError,
  withValidation,
} from '@/lib/form-data'
import { guard } from '@/lib/rate-limit'
import { CATEGORIES, DEFAULT_CATEGORY } from '@/core/categories/categories'
import type { CoolingUnit } from '@/types'
import { SNOOZE_MINUTES_DEFAULT } from '@/lib/constants'

const VALID_CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id))

const COOLING_UNITS = new Set<CoolingUnit>(['MINUTES', 'HOURS', 'DAYS', 'WEEKS'])

async function getAuthUserId(): Promise<string> {
  const user = await getCurrentUser()
  if (!user) throw new ValidationError('Unauthorized')
  await ensureUserRecord(user)
  return user.id
}

function unitToSuffix(unit: CoolingUnit): string {
  if (unit === 'MINUTES') return 'm'
  if (unit === 'HOURS') return 'h'
  if (unit === 'DAYS') return 'd'
  return 'w'
}

export async function logItem(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let userId: string | null = null
  const result = await withValidation(async () => {
    const title = getRequiredString(formData, 'title')
    const amountCents = getRequiredCents(formData, 'amount')
    const coolingValueRaw = getRequiredString(formData, 'coolingValue')
    const coolingUnit = getRequiredString(formData, 'coolingUnit') as CoolingUnit

    if (!COOLING_UNITS.has(coolingUnit)) throw new ValidationError('Invalid cooling unit.')

    const coolingValue = parseInt(coolingValueRaw, 10)
    if (!Number.isFinite(coolingValue) || coolingValue <= 0) {
      throw new ValidationError('Cooling period must be a positive number.')
    }

    userId = await getAuthUserId()
    await guard(`logItem:${userId}`, 30, 60)
    const coolingUntil = computeCoolingUntil(new Date(), coolingValue, coolingUnit)
    const note = getString(formData, 'note')?.trim() || undefined
    const rawCategory = getString(formData, 'category')?.trim()
    const category = rawCategory && VALID_CATEGORY_IDS.has(rawCategory) ? rawCategory : DEFAULT_CATEGORY

    await itemsRepo.create({ userId, title, amountCents, coolingUntil, note, category })
    await usersRepo.updateDefaultCoolingPeriod(userId, `${coolingValue}${unitToSuffix(coolingUnit)}`)
  }, 'action:logItem')

  if (userId) {
    updateTag(`items-user-${userId}`)
    // updateDefaultCoolingPeriod mutates the user row
    updateTag(`user-${userId}`)
  }
  return typeof result === 'string' ? result : null
}

export async function resolveItem(id: string, outcome: 'BOUGHT' | 'SKIPPED') {
  const userId = await getAuthUserId()
  await itemsRepo.resolve(id, userId, outcome)
  updateTag(`items-user-${userId}`)
}

export async function editWin(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let userId: string | null = null
  const result = await withValidation(async () => {
    const id = getRequiredString(formData, 'id')
    const title = getRequiredString(formData, 'title')
    const amountCents = getRequiredCents(formData, 'amount')
    const outcome = getRequiredString(formData, 'outcome')
    if (outcome !== 'BOUGHT' && outcome !== 'SKIPPED') {
      throw new ValidationError('Invalid outcome.')
    }
    userId = await getAuthUserId()
    const rawCategory = getString(formData, 'category')?.trim()
    const category = rawCategory && VALID_CATEGORY_IDS.has(rawCategory) ? rawCategory : undefined
    await itemsRepo.updateResolved(id, userId, { title, amountCents, status: outcome, ...(category && { category }) })
  }, 'action:editWin')

  if (userId) updateTag(`items-user-${userId}`)
  return typeof result === 'string' ? result : null
}

export async function editCoolingItem(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  let userId: string | null = null
  const result = await withValidation(async () => {
    const id = getRequiredString(formData, 'id')
    const title = getRequiredString(formData, 'title')
    const amountCents = getRequiredCents(formData, 'amount')
    const coolingValueRaw = getRequiredString(formData, 'coolingValue')
    const coolingUnit = getRequiredString(formData, 'coolingUnit') as CoolingUnit

    if (!COOLING_UNITS.has(coolingUnit)) throw new ValidationError('Invalid cooling unit.')
    const coolingValue = parseInt(coolingValueRaw, 10)
    if (!Number.isFinite(coolingValue) || coolingValue <= 0) {
      throw new ValidationError('Cooling period must be a positive number.')
    }

    userId = await getAuthUserId()
    const coolingUntil = computeCoolingUntil(new Date(), coolingValue, coolingUnit)
    const rawCategory = getString(formData, 'category')?.trim()
    const category = rawCategory && VALID_CATEGORY_IDS.has(rawCategory) ? rawCategory : undefined
    await itemsRepo.updateCooling(id, userId, { title, amountCents, coolingUntil, ...(category && { category }) })
  }, 'action:editCoolingItem')

  if (userId) updateTag(`items-user-${userId}`)
  return typeof result === 'string' ? result : null
}

export async function snoozeItem(id: string, minutes = SNOOZE_MINUTES_DEFAULT) {
  const userId = await getAuthUserId()
  await itemsRepo.snooze(id, userId, minutes)
  updateTag(`items-user-${userId}`)
}
