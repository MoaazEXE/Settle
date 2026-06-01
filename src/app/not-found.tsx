import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background p-7">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <span className="text-xl font-semibold text-muted-foreground">?</span>
        </div>
        <h1 className="mb-1 text-base font-semibold text-foreground">Page not found</h1>
        <p className="mb-6 text-xs text-muted-foreground leading-relaxed">
          Sorry, we couldn&apos;t find the page you&apos;re looking for.
        </p>
        <Link
          href="/"
          className="inline-flex h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-deep transition-colors"
        >
          Go back home
        </Link>
      </div>
    </div>
  )
}
