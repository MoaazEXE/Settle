import Link from 'next/link'
import { BrandMark } from '@/components/ui/brand-mark'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — Settle',
  description: 'What data Settle collects, why, and what we never do with it.',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[480px] lg:max-w-[560px] px-6 lg:px-10 pt-8 lg:pt-14 pb-16">
        <div className="mb-10 lg:mb-14">
          <Link href="/" prefetch aria-label="Back to home">
            <BrandMark size="md" />
          </Link>
        </div>

        <p className="text-[11px] lg:text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
          Privacy Policy
        </p>
        <h1 className="font-display text-4xl lg:text-5xl font-semibold leading-[1.05] tracking-tight text-foreground mb-3">
          Your data,<br />
          <em className="not-italic text-primary font-display italic">plainly stated.</em>
        </h1>
        <p className="text-body-lg lg:text-base text-muted-foreground leading-relaxed mb-10 lg:mb-12">
          Last updated: May 2026
        </p>

        <div className="space-y-10">
          <Section title="What we collect">
            <p>
              To run Settle, we store the minimum needed to make it work:
            </p>
            <ul className="mt-3 space-y-2">
              <Item>Your <strong>name and email address</strong> — so you can sign in and we know whose account is whose.</Item>
              <Item>The <strong>items you log</strong> — the thing you wanted, the price, the wait you set, and the decision you made.</Item>
              <Item>Your <strong>friend connections and shared groups</strong> — only the ones you create yourself.</Item>
              <Item>Basic <strong>usage signals</strong> (like when you last opened the app) — so we can keep the product running well.</Item>
            </ul>
            <p className="mt-3">
              If you sign in with Google, we receive your name and email from Google. We don&apos;t receive your Google password or any other Google data.
            </p>
          </Section>

          <Section title="Why we collect it">
            <p>
              Every piece of data above has one job: making the app work for you.
            </p>
            <ul className="mt-3 space-y-2">
              <Item>Your email lets you sign in and receive your confirmation link.</Item>
              <Item>Your logged items are your personal record — the whole point of the app.</Item>
              <Item>Friend and group data powers the shared features, and only you control who you invite.</Item>
            </ul>
            <p className="mt-3">
              We don&apos;t collect data to build profiles, run ads, or sell to anyone.
            </p>
          </Section>

          <Section title="What we never do">
            <ul className="space-y-2">
              <Item><strong>Sell your data.</strong> Your data is yours. We don&apos;t sell it, rent it, or trade it.</Item>
              <Item><strong>Share it with advertisers.</strong> There are no ads on Settle, and there never will be.</Item>
              <Item><strong>Use it to train AI models.</strong> Your logs stay yours — we don&apos;t feed them to language models or anything else.</Item>
              <Item><strong>Track you across the web.</strong> No third-party tracking pixels, no cross-site fingerprinting.</Item>
              <Item><strong>Store your payment details.</strong> We don&apos;t take payment and we don&apos;t store financial credentials.</Item>
            </ul>
          </Section>

          <Section title="Third-party services">
            <p>
              We use a small number of trusted services to run Settle:
            </p>
            <ul className="mt-3 space-y-2">
              <Item><strong>Supabase</strong> — stores your account and app data, hosted on AWS.</Item>
              <Item><strong>Vercel</strong> — serves the app.</Item>
              <Item><strong>Google OAuth</strong> — optional sign-in only; no data beyond name and email.</Item>
            </ul>
            <p className="mt-3">
              Each of these is bound by their own privacy policies. We choose services that take data handling seriously and we don&apos;t give them more than they need to do their job.
            </p>
          </Section>

          <Section title="Deleting your account">
            <p>
              You can delete your account at any time from Settings. When you do:
            </p>
            <ul className="mt-3 space-y-2">
              <Item>All your logged items are permanently deleted.</Item>
              <Item>Your profile and email are removed from our database.</Item>
              <Item>Any shared groups you own are dissolved.</Item>
            </ul>
            <p className="mt-3">
              Deletion is permanent. We don&apos;t keep backups of deleted accounts beyond our standard 30-day infrastructure snapshots, after which your data is gone for good.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              If we ever change what we collect or how we use it, we&apos;ll update this page and note the date at the top. We won&apos;t make changes that weaken your privacy without letting you know first.
            </p>
          </Section>

          <Section title="Questions">
            <p>
              If you have any questions about this policy or your data, email us at{' '}
              <a
                href="mailto:mouazkhamis@gmail.com"
                className="font-semibold text-primary hover:underline"
              >
                mouazkhamis@gmail.com
              </a>
              .
            </p>
          </Section>
        </div>

        <div className="mt-12 pt-8 border-t border-sep">
          <Link href="/" prefetch className="text-sm font-semibold text-primary hover:underline">
            ← Back to Settle
          </Link>
        </div>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[11px] lg:text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">
        {title}
      </p>
      <div className="text-[13.5px] lg:text-sm text-foreground leading-relaxed space-y-1">
        {children}
      </div>
    </section>
  )
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13.5px] lg:text-sm text-foreground leading-relaxed">
      <span className="mt-[5px] flex-shrink-0 w-1 h-1 rounded-full bg-primary-soft" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}
