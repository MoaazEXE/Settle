'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * App-wide realtime subscription. Mounted once in the (app) layout, it listens
 * for any change the signed-in user can see and calls router.refresh() — which,
 * because the app is Server-Component-rendered, re-runs the layout + current
 * page queries. That single refresh keeps the notification bell, dashboard,
 * cooling page and groups list live without a manual reload.
 *
 * Subscriptions (Supabase postgres_changes, scoped by RLS):
 *   - Item        (userId)  → dashboard, cooling page, bell "ready to decide"
 *   - GroupMember (userId)  → invites appearing/changing, joining groups
 *   - Expense     (groupId) → bell "group activity" + groups list balances
 *
 * The group detail page additionally uses useGroupRealtime for per-group
 * GroupMember/GuestMember changes by *other* members.
 *
 * Filters match on DELETE only when the table has REPLICA IDENTITY FULL — see
 * prisma/realtime.sql.
 */
export function useAppRealtime(userId: string, groupIds: string[]) {
  const router = useRouter()
  // Stable ref so swapping the router object between renders doesn't tear
  // down the channel. Synced in an effect (never written during render).
  const refreshRef = useRef(router.refresh)
  useEffect(() => {
    refreshRef.current = router.refresh
  }, [router])

  // Stable primitive dependency — re-subscribes when the user's group set
  // changes (e.g. after accepting an invite).
  const groupKey = groupIds.join(',')

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    // Coalesce bursts (an expense write touches several rows) into one refresh.
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refreshRef.current(), 150)
    }

    const channel = supabase
      .channel(`app-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Item', filter: `userId=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'GroupMember', filter: `userId=eq.${userId}` }, refresh)

    for (const gid of groupIds) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'Expense', filter: `groupId=eq.${gid}` }, refresh)
    }

    channel.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
    // groupKey stands in for groupIds (arrays are referentially unstable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, groupKey])
}
