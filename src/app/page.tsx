import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BrandMark } from '@/components/ui/brand-mark'
import { Plus, Clock, Check, Users } from 'lucide-react'
import { LandingCta } from '@/app/_components/landing-cta'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[480px] lg:max-w-[560px] px-6 lg:px-10 pt-8 lg:pt-14 pb-10">
        <div className="mb-10 lg:mb-14">
          <BrandMark size="md" />
        </div>

        <p className="text-[11px] lg:text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
          The money you didn&apos;t spend
        </p>
        <h1 className="font-display text-5xl lg:text-6xl font-semibold leading-[1.02] tracking-tight text-foreground">
          Pause before
          <br />
          <em className="not-italic text-primary font-display italic">you buy.</em>
        </h1>

        <p className="mt-5 text-body-lg lg:text-base text-muted-foreground leading-relaxed">
          Most apps track what you spent. Settle helps you notice the pause between wanting
          something and buying it — and keeps a quiet count of what stayed yours.
        </p>

        <section className="mt-10 lg:mt-12">
          <p className="text-[11px] lg:text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-5">
            How it works
          </p>
          <ul className="space-y-5">
            <Step n={1} icon={<Plus size={14} strokeWidth={2.2} />} title="Log the temptation">
              Note what you want — before you buy it.
            </Step>
            <Step n={2} icon={<Clock size={14} strokeWidth={2.2} />} title="Let it cool">
              Pick a wait. An hour, a day, a week.
            </Step>
            <Step n={3} icon={<Check size={14} strokeWidth={2.2} />} title="Decide with a clear head">
              Buy it, skip it, or snooze. No pressure.
            </Step>
          </ul>
        </section>

        <div className="mt-8 lg:mt-10 rounded-2xl bg-gold-tint px-5 py-4 flex items-start gap-3.5">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gold/30 flex items-center justify-center text-gold-deep">
            <Users size={16} strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep mb-1">
              + With friends
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              Split real expenses, or cool on group buys together.
            </p>
          </div>
        </div>

        <LandingCta />

        <footer className="mt-8 text-center text-xs text-subtle-foreground">
          Made with love by{' '}
          <a
            href="https://moaazexe.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-muted-foreground transition-colors"
          >
            Moaaz
          </a>
        </footer>
      </div>
    </main>
  )
}

function Step({
  n,
  icon,
  title,
  children,
}: {
  n: number
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-tint text-primary-deep text-sm font-semibold flex items-center justify-center tabular-nums">
        {n}
      </div>
      <div className="flex-1 pt-0.5">
        <p className="text-body-lg lg:text-base font-semibold text-foreground inline-flex items-center gap-1.5">
          {title}
          <span className="text-muted-foreground">{icon}</span>
        </p>
        <p className="mt-0.5 text-[13.5px] lg:text-sm text-muted-foreground leading-relaxed">
          {children}
        </p>
      </div>
    </li>
  )
}
