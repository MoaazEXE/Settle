import { groupsRepo } from '@/data/groups.repo'
import { getCurrentUser } from '@/lib/supabase/server'
import { AppRealtime } from './app-realtime'

/**
 * Server wrapper that resolves the current user + their active group IDs, then
 * renders the client <AppRealtime>. Wrapped in <Suspense fallback={null}> at the
 * layout so it never blocks the shell from painting.
 */
export async function AppRealtimeData() {
  const user = await getCurrentUser()
  if (!user) return null

  const groupIds = await groupsRepo.findActiveGroupIdsByUser(user.id)

  return <AppRealtime userId={user.id} groupIds={groupIds} />
}
