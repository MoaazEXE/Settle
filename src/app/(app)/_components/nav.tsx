'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Home, Clock, Users, Wallet, LogOut } from 'lucide-react'
import { signOut } from '@/app/actions/auth'
import { useFmt } from '@/lib/currency-context'
import { BrandMark } from '@/components/ui/brand-mark'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/cooling', label: 'Cooling', icon: Clock },
  { href: '/groups', label: 'Groups', icon: Users },
  { href: '/settings', label: 'Income', icon: Wallet },
] as const

interface Props {
  name: string
  email: string
  initial: string
  avatarUrl?: string | null
  savedCents: number
  coolingCount: number
  groupsCount: number
}

export function Nav({ name, email, initial, avatarUrl, savedCents, coolingCount, groupsCount }: Props) {
  const pathname = usePathname()
  const fmt = useFmt()

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href))

  const badgeCount = (href: string) => {
    if (href === '/cooling') return coolingCount
    if (href === '/groups') return groupsCount
    return 0
  }

  return (
    <>
      {/* Sidebar — icon-only at md (768–1023px), full at lg (1024px+) */}
      <aside className="hidden md:flex md:w-16 lg:w-60 shrink-0 h-screen sticky top-0 border-r border-sep bg-bg-deep flex-col md:items-center md:px-2 lg:items-stretch lg:px-4 pt-6 pb-5">
        <div className="pb-5 md:px-0 lg:px-2">
          <BrandMark size="md" href="/dashboard" className="lg:block hidden" />
          {/* Icon-only brand dot at md */}
          <Link href="/dashboard" className="lg:hidden flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground text-sm font-bold">
            S
          </Link>
        </div>

        <div className="mb-5 rounded-lg bg-card shadow-card w-full lg:px-4 lg:py-3.5 md:px-2 md:py-2 lg:block hidden">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Saved by waiting
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-primary tracking-tight tabular-nums">
            {fmt(savedCents)}
          </p>
        </div>

        <nav className="flex flex-col gap-0.5 flex-1 w-full">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href)
            const count = badgeCount(href)
            return (
              <Link
                key={href}
                href={href}
                prefetch
                title={label}
                className={cn(
                  'h-10 rounded-sm flex items-center transition-colors md:justify-center lg:justify-start md:px-0 lg:px-3.5 md:gap-0 lg:gap-3 text-sm font-medium',
                  active
                    ? 'bg-card text-primary-deep shadow-active-inset'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                <div className="relative flex-shrink-0">
                  <Icon size={18} strokeWidth={1.8} />
                  {count > 0 && (
                    <span className="lg:hidden absolute -top-1.5 -right-1.5 h-4 min-w-4 px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold inline-flex items-center justify-center tabular-nums leading-none">
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </div>
                <span className="flex-1 hidden lg:block">{label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      'hidden lg:inline-flex h-5 min-w-5 px-1.5 rounded-full text-[11px] font-semibold items-center justify-center tabular-nums',
                      active
                        ? 'bg-primary-tint text-primary-deep'
                        : 'bg-foreground/6 text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2.5 rounded-md bg-card shadow-card w-full md:flex-col md:p-2 lg:flex-row lg:px-3 lg:py-2.5">
          <Link href="/profile" title={name} className="flex items-center gap-2.5 lg:flex-1 min-w-0 hover:opacity-80 transition-opacity">
            {avatarUrl ? (
              <Image src={avatarUrl} alt={name} width={32} height={32} className="flex-shrink-0 w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0 hidden lg:block">
              <p className="text-xs font-semibold truncate">{name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{email}</p>
            </div>
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:bg-foreground/6 transition-colors"
            >
              <LogOut size={14} strokeWidth={1.8} />
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile bottom tab bar — hidden at md+ where sidebar takes over */}
      <nav className="flex md:hidden fixed bottom-0 inset-x-0 z-30 bg-background/95 backdrop-blur-sm border-t border-sep h-[60px]">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          const count = badgeCount(href)
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className="flex-1 flex flex-col items-center justify-center gap-0.5"
            >
              <div className={cn('relative', active ? 'text-primary' : 'text-muted-foreground')}>
                <Icon size={22} strokeWidth={active ? 2 : 1.6} />
                {count > 0 && (
                  <span className="absolute -top-1 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold inline-flex items-center justify-center tabular-nums leading-none">
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium leading-none',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
