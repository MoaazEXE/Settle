import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Vercel Cron invokes this on a schedule (see vercel.json). It must run on the
// Node.js runtime (Prisma) and never be statically optimized.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Deletes RateLimit rows whose window started more than a day ago. The
 * rate-limit table is append-mostly and would otherwise grow unbounded, since
 * the limiter itself only ever reads/increments the current window.
 *
 * Protected by a shared secret: requests must carry
 * `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron automatically sends this
 * header when CRON_SECRET is configured in the project's environment.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  // Fail closed: if no secret is configured we refuse rather than run unguarded.
  if (!secret) {
    return new NextResponse('Cron not configured', { status: 401 })
  }

  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: cutoff } },
  })

  return NextResponse.json({ deleted: count, cutoff: cutoff.toISOString() })
}
