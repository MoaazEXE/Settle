'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Module-level refcount map — prevents duplicate channels when the hook is
// mounted multiple times for the same group (e.g. StrictMode double-invoke,
// or two sibling components both calling the hook).
const channels = new Map<string, { ch: RealtimeChannel; refCount: number }>()

export function useGroupRealtime(groupId: string) {
  const router = useRouter()
  // Stable callback ref — avoids tearing down/recreating the channel when
  // Next.js swaps the router object reference between renders.
  const refreshRef = useRef(router.refresh)
  useEffect(() => {
    refreshRef.current = router.refresh
  }, [router])

  useEffect(() => {
    if (!groupId) return

    const existing = channels.get(groupId)
    if (existing) {
      existing.refCount++
      return () => {
        existing.refCount--
        if (existing.refCount === 0) {
          const supabase = createClient()
          supabase.removeChannel(existing.ch)
          channels.delete(groupId)
        }
      }
    }

    // Expense changes for this group are handled by the app-wide useAppRealtime
    // subscription (it listens to Expense for every active group). This hook
    // only adds the per-group signals the global one can't filter for:
    // GroupMember/GuestMember changes by *other* members of the open group.
    const supabase = createClient()
    const ch = supabase
      .channel(`group-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'GroupMember', filter: `groupId=eq.${groupId}` }, () => refreshRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'GuestMember', filter: `groupId=eq.${groupId}` }, () => refreshRef.current())
      .subscribe()

    channels.set(groupId, { ch, refCount: 1 })

    return () => {
      const entry = channels.get(groupId)
      if (!entry) return
      entry.refCount--
      if (entry.refCount === 0) {
        supabase.removeChannel(entry.ch)
        channels.delete(groupId)
      }
    }
  }, [groupId])
}
