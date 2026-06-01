'use client'

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('[Profile error]', error)
  }, [error])

  const handleRetry = useCallback(() => {
    // Refresh the server-side data first, then re-render the error boundary
    router.refresh()
    // Small delay to let the refresh kick in before resetting the boundary
    setTimeout(() => reset(), 100)
  }, [router, reset])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-5 text-center">
      <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="var(--destructive)" strokeWidth="1.8" />
          <path d="M12 8v5" stroke="var(--destructive)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16" r="1" fill="var(--destructive)" />
        </svg>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-foreground">Something went wrong</h2>
      <p className="mb-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
        {error.message || 'Could not load your profile. This may be a temporary issue.'}
      </p>
      {error.digest && (
        <p className="mb-4 font-mono text-[11px] text-muted-foreground/60">
          Error ID: {error.digest}
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={handleRetry}
          className="h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-deep transition-colors active:scale-[0.97]"
        >
          Try again
        </button>
        <button
          onClick={() => router.push('/dashboard')}
          className="h-11 px-6 rounded-lg bg-card border border-border text-foreground text-sm font-semibold hover:bg-muted transition-colors"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  )
}
