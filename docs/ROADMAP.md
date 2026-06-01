# Roadmap

Where Settle is today and where it's headed. The product is feature-complete
against its spec for the Shortcut Asia Internship Challenge 2026; this is the
honest view of what's shipped, what's intentionally deferred, and what comes
next.

## Shipped

**Core experience**
- Log a temptation, let it cool for a chosen period, then decide: Buy, Skip, or
  Snooze — with the savings from every Skip rolled into a running total.
- Time-cost engine that translates a price into "hours of your life" (simple and
  true-hourly modes).
- Savings milestones and a dashboard that celebrates what you *didn't* spend.

**Groups & splitting**
- Shared groups with invites, guest members, and per-expense splitting.
- Cooling *proposals* for group purchases (propose → react → commit/cancel).
- Debt simplification: settle up in the fewest possible transfers, with a
  "how we got there" evidence trail.

**Platform & polish**
- Live updates across the app via Supabase Realtime — the notification bell,
  dashboard, cooling list, and group views refresh without a manual reload.
- Optimistic, instant-feeling interactions; Suspense-streamed pages with
  skeletons for instant navigation.
- Full keyboard/focus accessibility on sheets and dialogs; command-palette search.
- Responsive across phone, tablet, and desktop.
- Hardened for production: input validation and rate limiting on every mutation,
  JWT-verified auth, RLS as defense-in-depth, CSV-injection-safe export,
  magic-byte avatar validation, and security headers.

## Intentionally deferred

Honest trade-offs made for the challenge timeline, with the reasoning recorded
in [DECISIONS.md](./DECISIONS.md):

- **Prisma migration history** — schema is driven by `db push` for a solo
  project; a proper migration pipeline is a pre-real-production task.
- **Dark mode** — out of scope for the deadline.
- **Cursor pagination + SQL-side balance aggregation** — an interim row cap
  covers demo scale; full pagination lands when real usage demands it.
- **Cache Components (`'use cache'`) migration** — current caching works; this is
  a deliberate, separately-QA'd refactor.

## Next

Near-term hardening and quality:
- Installable PWA + offline shell for a native-feeling repeat-open experience.
- Expanded automated test coverage on the server-action layer.

Post-launch product directions (from the original spec):
- **Native mobile** via React Native — the framework-free `core/` ports directly.
- **Per-person private time-cost** within groups, so each member sees a purchase
  in their own hours.
- **Smart cooling periods** — longer cooling suggested when an item is a large
  share of income.
- **Receipt OCR** for instant expense splitting.
- **Pattern insights** — your most-tempted categories and times of day.
