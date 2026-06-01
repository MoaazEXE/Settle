'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Search, Plus } from 'lucide-react'
import { NotificationBell, type PendingInvite, type GroupExpenseNotif } from './notification-bell'
import { SearchPalette } from './search-palette'
import { useLogModal } from './log-modal-context'
import { BrandMark } from '@/components/ui/brand-mark'

interface CoolingItem {
  id: string
  title: string
  amountCents: number
  coolingUntil: Date
}

interface Props {
  coolingItems: CoolingItem[]
  invites: PendingInvite[]
  groupExpenses: GroupExpenseNotif[]
  userInitial: string
  userAvatarUrl?: string | null
}

export function TopBar({ coolingItems, invites, groupExpenses, userInitial, userAvatarUrl }: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const log = useLogModal()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
      if (e.key === 'Escape' && searchOpen) setSearchOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [searchOpen])

  return (
    <>
      <header className="h-16 sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-sep flex items-center px-4 lg:px-6 gap-3">
        <div className="lg:hidden flex-shrink-0">
          <BrandMark size="sm" showName={false} href="/dashboard" />
        </div>

        <button
          onClick={() => setSearchOpen(true)}
          className="hidden lg:flex flex-1 max-w-[520px] mx-auto h-10 px-4 rounded-md bg-card border border-sep items-center gap-3 text-left text-subtle-foreground hover:border-sep-strong transition-colors"
          aria-label="Search"
        >
          <Search size={16} strokeWidth={1.8} />
          <span className="flex-1 text-sm">Search items, groups, or members</span>
        </button>

        <div className="lg:hidden flex-1" />

        <button
          onClick={() => setSearchOpen(true)}
          className="lg:hidden w-11 h-11 rounded-md flex items-center justify-center hover:bg-foreground/5 transition-colors"
          aria-label="Search"
        >
          <Search size={18} strokeWidth={1.8} className="text-muted-foreground" />
        </button>

        <NotificationBell items={coolingItems} invites={invites} groupExpenses={groupExpenses} />

        <button
          onClick={log.open}
          className="hidden lg:inline-flex h-10 items-center gap-2 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-deep transition-colors active:scale-[0.97]"
        >
          <Plus size={16} strokeWidth={2.2} />
          Log temptation
        </button>

        <Link
          href="/profile"
          className="lg:hidden flex-shrink-0 w-10 h-10 rounded-full overflow-hidden bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold"
          aria-label="Profile"
        >
          {userAvatarUrl ? (
            <Image
              src={userAvatarUrl}
              alt=""
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          ) : (
            userInitial
          )}
        </Link>
      </header>

      <SearchPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
