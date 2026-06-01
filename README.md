# Settle — The money you didn't spend

A personal finance app that **intervenes before the money leaves**. Log temptations, let them cool, and celebrate what you didn't spend — solo or with a group.

Built for the Shortcut Asia Internship Challenge 2026 (23 May – 2 June).

- **🔗 Live app:** https://settle-moexe.vercel.app/
- **🎥 Demo video:** <!-- TODO: add link --> _coming soon — to be added before submission_

## Core features

- **Cool-down spending (solo).** Log a temptation, let it sit for a chosen cooling period, then decide **Buy / Skip / Snooze**. Every Skip rolls into a running total of the money you _didn't_ spend, with a time-cost view of each purchase in "hours of your life".
- **Group splitting & settle-up.** Shared groups with invites and guests, per-expense splitting, cooling _proposals_ for group buys, and one-tap **settle-up** that simplifies everyone down to the fewest possible transfers.

## Tech stack

| Layer     | Choice                               |
| --------- | ------------------------------------ |
| Framework | Next.js 16 (App Router) + TypeScript |
| Database  | Supabase (Postgres + Auth + Storage) |
| ORM       | Prisma 5                             |
| UI        | Tailwind CSS v4 + shadcn/ui          |
| Charts    | Recharts                             |
| Tests     | Vitest                               |
| Hosting   | Vercel                               |

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local` with your Supabase project credentials. The app will not boot without `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, and `NEXT_PUBLIC_APP_URL`. `SUPABASE_SERVICE_ROLE_KEY` is required for account deletion and avatar upload; `CRON_SECRET` is optional (only used by the production cleanup cron).

### 3. Push the database schema

```bash
npx prisma db push
```

This project does not currently keep a `prisma/migrations/` history — schema state is driven by `prisma/schema.prisma` and `db push`. Initializing a proper migration history is on the [docs/AUDIT.md](docs/AUDIT.md) list before going to real production.

### 4. Apply Row-Level Security

After the first `db push`, run `prisma/rls.sql` once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste & run). This file installs:

- the `handle_new_user` trigger that creates a `User` row on signup,
- RLS policies on every user-facing table,
- deny-by-default RLS on the server-only `RateLimit` table.

The Prisma runtime connection bypasses RLS (it's the Postgres owner), so these policies are defense-in-depth that protect direct REST / realtime access via the anon key. **Application-layer guards in `src/app/actions/*` are the real auth boundary.**

### 5. Enable Realtime

Run `prisma/realtime.sql` once in the same SQL editor. It adds the live-updated tables to the `supabase_realtime` publication and sets `REPLICA IDENTITY FULL`, so the notification bell, dashboard, cooling list, and group views update without a manual refresh.

### 6. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 7. Run unit tests

```bash
npm test
```

Tests cover the pure core modules (`cooling/`, `debt/`, `timecost/`, `savings/`, `milestones/`) and the `groups` repo.

## Production deployment (Vercel)

Before promoting to prod, confirm:

1. All env vars from `.env.example` set in **Vercel → Project Settings → Environment Variables**. `SUPABASE_SERVICE_ROLE_KEY` must NOT have the `NEXT_PUBLIC_` prefix; scope it to **Production** only (not Preview, if you accept PRs from forks).
2. **Supabase → Authentication → URL Configuration**: Site URL = `https://<your-domain>`; Redirect URLs include `https://<your-domain>/auth/callback`.
3. **Supabase → Authentication → Providers → Google**: client ID + secret set, Google Cloud OAuth client lists `https://<project-ref>.supabase.co/auth/v1/callback` as authorized redirect URI.
4. `prisma/rls.sql` ran successfully against the production database (verify with `SELECT * FROM pg_policies WHERE schemaname = 'public';`).
5. Avatar storage bucket `avatars` exists and is public-read.

## Architecture

```
src/
├── app/          # Next.js App Router (thin route handlers + page shells)
│   ├── (auth)/   # login / signup
│   └── (app)/    # authenticated shell: dashboard, cooling, groups, settings
├── core/         # ★ Pure domain logic — framework-free, fully tested
│   ├── cooling/  # State machine: status computed from timestamps, never client timers
│   ├── debt/     # Debt simplification: minimum cash-flow algorithm
│   ├── timecost/ # Time-cost engine: price → hours of your life (simple + true-hourly)
│   └── savings/  # Derive "saved by waiting" totals (never stored as a column)
├── data/         # Prisma repository layer
├── lib/          # Supabase clients, Prisma singleton
└── types/        # Shared domain types
```

## Key design decisions

- **Money as integer cents** everywhere — no floating-point arithmetic.
- **Cooling is computed, not counted** — `coolingUntil > now()` on every read; closing a tab can't break the state.
- **Savings totals are derived, never stored** — sum of SKIPPED items on read keeps them always-correct.
- **Core logic is framework-free** — `src/core/` has zero Next.js or Prisma imports, making it trivially testable and portable to a future mobile API.
- **Auth boundary is the server action**, not RLS. Every server action calls `getCurrentUser()` (which JWT-verifies via Supabase) and then enforces ownership/membership in code. RLS is a defense-in-depth net behind that.

## Documentation

Deeper docs live in [`/docs`](docs/):

- [**ARCHITECTURE.md**](docs/ARCHITECTURE.md) — system structure, layering, data flow, and realtime.
- [**DECISIONS.md**](docs/DECISIONS.md) — the "why" behind the key technical decisions.
- [**SETUP.md**](docs/SETUP.md) — full local setup and the production deployment checklist.
- [**ROADMAP.md**](docs/ROADMAP.md) — what's shipped, what's deferred, and what's next.
- [**AUDIT.md**](docs/AUDIT.md) — production-readiness audit (security, scalability, performance).
- [**SUBMISSION_NOTES.md**](docs/SUBMISSION_NOTES.md) — the idea, decisions, feature deep-dives, and challenges (challenge writeup material).
