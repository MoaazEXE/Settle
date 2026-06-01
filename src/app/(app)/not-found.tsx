import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-5 text-center">
      <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="var(--muted-foreground)" strokeWidth="1.8" />
          <path
            d="M12 7v5m0 4v.01"
            stroke="var(--muted-foreground)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-foreground">Page not found</h2>
      <p className="mb-6 max-w-xs text-sm text-muted-foreground leading-relaxed">
        Sorry, we couldn&apos;t find the page you&apos;re looking for.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-deep transition-colors active:scale-[0.97]"
      >
        Go to dashboard
      </Link>
    </div>
  )
}
