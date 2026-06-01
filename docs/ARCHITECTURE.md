# Architecture

How Settle is put together, and the reasoning behind the layering. For the *why*
behind specific choices, see [DECISIONS.md](./DECISIONS.md). For running it
locally, see [SETUP.md](./SETUP.md).

## High-level shape

Settle is a single Next.js 16 (App Router) application deployed as Vercel
Functions, talking to a Supabase Postgres database through Prisma. There is no
separate backend service — Server Components and Server Actions *are* the
backend.

```
Browser ──RSC/Server Action──▶ Vercel Function ──Prisma──▶ Supabase Postgres
   ▲                                                            │
   └───────────── Supabase Realtime (WebSocket) ◀───────────────┘
```

## Directory layout

```
src/
├── app/                  # App Router: route segments, layouts, server actions
│   ├── (auth)/           # Unauthenticated: login / signup
│   ├── (app)/            # Authenticated shell: dashboard, cooling, groups, settings, profile
│   ├── (onboarding)/     # First-run onboarding flow
│   ├── actions/          # 'use server' actions — the write + auth boundary
│   └── api/              # Route handlers: search, CSV export, cron cleanup
├── core/                 # ★ Pure domain logic — zero Next.js / Prisma imports
│   ├── cooling/          # Cooling state machine (status derived from timestamps)
│   ├── debt/             # Debt simplification (minimum cash-flow algorithm)
│   ├── timecost/         # Price → "hours of your life" engine
│   ├── savings/          # "Saved by waiting" derivations
│   ├── milestones/       # Savings milestone thresholds
│   └── categories/       # Spend categories
├── data/                 # Prisma repository layer — the only place that touches the DB
├── lib/                  # Supabase clients, Prisma singleton, formatters, constants, realtime hooks
├── components/ui/        # Design-system primitives
└── types/                # Shared domain types
```

## The layers, top to bottom

### 1. Route segments & Server Components (`src/app/**/page.tsx`)
Pages are thin. They resolve the current user, call into the repository layer
for data, and render. Heavy pages stream their sections behind `<Suspense>` so
the shell paints immediately on navigation, with skeletons from `loading.tsx`.

### 2. Server Actions (`src/app/actions/*`)
Every mutation is a `'use server'` action wrapped in `withValidation(scope)`,
which centralizes input parsing (typed FormData helpers), error logging, and
rate limiting. **This is the real authorization boundary** — each action calls
`getCurrentUser()` (JWT-verified) and then enforces ownership/membership in code
via guards like `requireActiveMembership` and `requireExpenseMutator`.

### 3. Repository layer (`src/data/*.repo.ts`)
The only code that imports Prisma. Repos own all queries, wrap reads in
`unstable_cache` with tag-based invalidation (`groups-user-${id}`,
`group-${id}`, …), and expose a typed surface to the app. Server actions call
`updateTag(...)` after writes to invalidate exactly the affected reads.

### 4. Core domain (`src/core/*`)
Framework-free, fully unit-tested pure functions. No React, no Prisma, no
Next.js. This is where the actual product logic lives — the cooling state
machine, debt simplification, time-cost and savings math — so it's trivially
testable and portable to a future mobile API.

## Data flow examples

**Reading the dashboard:** `dashboard/page.tsx` → `Promise.all` of repo calls
(cached) → core functions compute derived values (savings, skip rate, time
cost) → rendered as RSC, streamed section-by-section.

**Logging a temptation:** client sheet → `createItem` server action →
`withValidation` (parse + rate-limit) → `getCurrentUser` → `itemsRepo` write →
`updateTag('items-user-…')` → affected Server Components re-render.

## Authentication

Supabase Auth (email/password + Google OAuth). On signup, a Postgres trigger
(`handle_new_user`, see `prisma/rls.sql`) creates the matching `User` row.
`getCurrentUser()` verifies the JWT via `supabase.auth.getUser()` and is wrapped
in React `cache()` so a request pays that network cost once. Row-Level Security
is enabled on every user-facing table as **defense-in-depth** — the Prisma
runtime connection bypasses it, so RLS only constrains direct REST/Realtime
access via the anon key (see [DECISIONS.md](./DECISIONS.md#auth-boundary)).

## Realtime

The UI updates live without manual refresh via Supabase `postgres_changes`:

- **`useAppRealtime`** (global, mounted in the `(app)` layout) — subscribes to
  `Item` by `userId`, `GroupMember` by `userId`, and `Expense` per active group;
  debounces bursts and calls `router.refresh()`, which re-runs the layout + page
  queries. This keeps the notification bell, dashboard, cooling page, and groups
  list live.
- **`useGroupRealtime`** (group detail page) — adds the per-group
  `GroupMember`/`GuestMember` events that the global hook can't filter for.

`Expense` is owned solely by the global hook to avoid duplicate refreshes.
Realtime is authorized by the same RLS SELECT policies, so each client only
receives change events for rows it can see. Enabling it requires running
`prisma/realtime.sql` once (publication + `REPLICA IDENTITY FULL`).

## Money & correctness invariants

- **Money is always integer cents** — no floating-point arithmetic anywhere.
  String input is parsed by `parseAmountToCents` (`src/lib/money.ts`), never
  `parseFloat(x) * 100`.
- **Cooling status is computed, not stored** — derived from `coolingUntil > now()`
  on every read, so a closed tab or missed timer can never desync state.
- **Savings totals are derived, not persisted** — summed from SKIPPED items on
  read, so they're always correct by construction.

## Tooling

- **Tests:** Vitest over the pure `core/` modules and the repo/guard layer.
- **CI:** `.github/workflows/check.yml` runs `tsc`, Vitest, and ESLint.
- **Hosting:** Vercel Functions pinned to `syd1` to co-locate with the Supabase
  region (see [DECISIONS.md](./DECISIONS.md#region)).
