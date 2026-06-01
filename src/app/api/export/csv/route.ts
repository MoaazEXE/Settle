import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/log-error'
import { DEFAULT_CURRENCY, CSV_EXPORT_LIMIT } from '@/lib/constants'

export const dynamic = 'force-dynamic'

function esc(v: string | null | undefined): string {
  if (!v) return ''
  let s = String(v)
  // Prefix formula-injection triggers so spreadsheet apps treat the cell as text
  if (s.length > 0 && '=+-@\t\r'.includes(s[0])) {
    s = `'${s}`
  }
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map(c => esc(c == null ? '' : String(c))).join(',')
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { consume } = await import('@/lib/rate-limit')
    const csvOk = await consume(`csv:${user.id}`, 5, 3600).catch(() => true)
    if (!csvOk) return new NextResponse('Too many export requests — try again later.', { status: 429 })

    const LIMIT = CSV_EXPORT_LIMIT
    const [items, expenses, dbUser] = await Promise.all([
      prisma.item.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
      }),
      prisma.expense.findMany({
        where: {
          group: { members: { some: { userId: user.id, status: 'ACTIVE' } } },
        },
        include: { group: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
      }),
      prisma.user.findUnique({ where: { id: user.id }, select: { currency: true } }),
    ])

    const currencyCode = dbUser?.currency ?? DEFAULT_CURRENCY

    const lines: string[] = []

    lines.push('TEMPTATIONS')
    lines.push(row('Title', `Amount (${currencyCode})`, 'Category', 'Status', 'Cooling until', 'Resolved at', 'Created at'))
    for (const i of items) {
      lines.push(row(
        i.title,
        (i.amountCents / 100).toFixed(2),
        i.category ?? 'other',
        i.status,
        i.coolingUntil.toISOString(),
        i.resolvedAt?.toISOString() ?? '',
        i.createdAt.toISOString(),
      ))
    }

    lines.push('')
    lines.push('GROUP EXPENSES')
    lines.push(row('Group', 'Description', `Amount (${currencyCode})`, 'Type', 'Status', 'Created at'))
    for (const e of expenses) {
      lines.push(row(
        e.group.name,
        e.description,
        (e.amountCents / 100).toFixed(2),
        e.type,
        e.status,
        e.createdAt.toISOString(),
      ))
    }

    if (items.length === LIMIT || expenses.length === LIMIT) {
      lines.push('')
      lines.push('# Export truncated to last 10,000 rows per section')
    }

    const date = new Date().toISOString().slice(0, 10)
    const csv = lines.join('\r\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="settle-export-${date}.csv"`,
      },
    })
  } catch (err) {
    await logError('api:export/csv', {}, err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
