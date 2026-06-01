'use client'

import { useAppRealtime } from '@/lib/use-app-realtime'

/**
 * Invisible mount point for the app-wide realtime subscription. Renders nothing;
 * exists only to run the hook inside the (app) layout.
 */
export function AppRealtime({ userId, groupIds }: { userId: string; groupIds: string[] }) {
  useAppRealtime(userId, groupIds)
  return null
}
