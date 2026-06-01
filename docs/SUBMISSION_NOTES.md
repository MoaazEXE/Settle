# Submission Notes — Settle (originally "Spnd")

> Raw material for a 1–2 page human-written writeup. Everything here is pulled
> from the codebase, the `/docs` files, the `core/` source comments, and the git
> history (55 commits). Factual and verbose on purpose — edit it down.
>
> **Naming:** the project began as **Spnd** and was rebranded to **Settle**
> mid-build (commits `dffe977` "rebrand to Settle", `98c615e` "update app name
> from Spnd to Settle"). Same product. Tagline: *"The money you didn't spend."*
> Live: https://settle-moexe.vercel.app/

---

## 1. The idea and why

**The insight.** Every other personal-finance app records spending *after the
money is gone* — they are ledgers of regret. Settle's bet is that the useful
moment is *before* the purchase, during the impulse. So the core loop is
**intervene before the money leaves**: when you feel the urge to buy something,
you log it as a "temptation," it enters a **cooling-off period** you choose, and
only after it cools do you decide Buy / Skip / Snooze. The product's headline
metric is inverted from a normal tracker — it celebrates **the money you did
*not* spend**, accumulated from everything you skipped.

**The second lever — time-cost.** A price tag is abstract; hours of your life
are not. Settle converts any amount into "hours of your life" using the user's
income and working hours (`src/core/timecost/timeCost.ts`). "RM 200" becomes
"6h 40min of work," which reframes the impulse. There are two modes: `SIMPLE`
(monthly income ÷ monthly work hours) and `TRUE_HOURLY` (subtracts commute time
and work-related costs for a truer effective wage).

**How it differs from a standard expense tracker:**
- It acts **pre-purchase**, not post-purchase. The unit of work is a *temptation*
  with a cooling timer, not a logged transaction.
- The hero number is **avoided spend** (sum of SKIPPED items), not total spend.
- It applies a **behavioral-economics framing** (cooling-off + time-cost +
  savings streaks + milestones) rather than categorization/budgeting.
- The **group mode** extends the same "cool before you commit" idea to shared
  purchases via cooling *proposals*, then settles balances — combining a
  Splitwise-style settle-up with the cooling concept.

---

## 2. Technical decisions made

**Stack:** Next.js 16 (App Router) + TypeScript · Supabase (Postgres + Auth +
Storage) · Prisma 5 · Tailwind CSS v4 + shadcn/ui · Recharts · Vitest · Vercel.

**Why Next.js App Router + React Server Components for data fetching.** There is
no separate backend service — Server Components and Server Actions *are* the
backend (`Browser ──RSC/Server Action──▶ Vercel Function ──Prisma──▶ Postgres`).
Pages fetch directly on the server via the repository layer, run several queries
in `Promise.all`, and stream each section behind `<Suspense>` with skeletons
from `loading.tsx` so the shell paints instantly on navigation. This avoids
building, versioning, and securing a REST/GraphQL layer for what is fundamentally
server-rendered data, and keeps secrets server-side.

**Why the layered `core/` architecture.** `src/core/` holds the actual product
logic — cooling state machine, debt simplification, time-cost engine, savings
math, milestones — as **pure functions with zero Next.js or Prisma imports.**
Benefits: (a) it's trivially unit-testable (Vitest runs over it with no DB or
framework harness), and (b) it's portable — the same logic could back a future
React Native client unchanged. The layering, top to bottom:
1. **Route segments / Server Components** — thin; resolve user, call repos, render.
2. **Server Actions** (`src/app/actions/*`) — every mutation, wrapped in
   `withValidation(scope)` which centralizes input parsing, error logging, and
   rate limiting. **This is the real authorization boundary.**
3. **Repository layer** (`src/data/*.repo.ts`) — the only code that imports
   Prisma; owns all queries; wraps reads in `unstable_cache` with tag-based
   invalidation (`groups-user-${id}`, `group-${id}`).
4. **Core domain** (`src/core/*`) — pure, tested, framework-free.

**Why Prisma over raw Supabase queries.** A typed schema and client give
compile-time safety across the whole data layer and one canonical place
(`prisma/schema.prisma`) for the model. It keeps all DB access funnelled through
the repository layer instead of scattered `supabase.from(...)` calls in
components. Note the consequence (see §4): Prisma connects as the Postgres owner
and **bypasses RLS**, which is why authorization had to live in the app layer and
RLS is treated as defense-in-depth.

**Other notable decisions (full list in `docs/DECISIONS.md`):**
- **Money is always integer cents.** Input parsed by `parseAmountToCents`
  (`src/lib/money.ts`) against a strict `^\d+(\.\d{1,2})?$` shape — never
  `Math.round(parseFloat(x) * 100)`, which is locale/edge-case fragile.
- **Cooling status is computed, not stored** — `coolingUntil > now()` on every
  read; a closed tab or dead timer can't desync state.
- **Savings totals are derived, never persisted** — summed from SKIPPED items on
  read, so the number is always correct by construction.
- **Auth boundary is the server action, not RLS** (see §4).
- **Region pinning** — Vercel Functions pinned to `syd1` to co-locate with the
  Supabase region (the big perf fix, §4).
- **Postgres-backed rate limiting** — a single `RateLimit` table + `consume()`
  instead of standing up Redis/Upstash for a solo project.

---

## 3. The two core features in depth

### A. The Cooling Queue (solo)

**Data model.** An `Item` has `status` (`COOLING | BOUGHT | SKIPPED`), an
`amountCents`, an optional `category`/`note`/`photoUrl`/`linkUrl`, a
`coolingUntil` timestamp, and `createdAt`/`resolvedAt`.

**Mechanics (`src/core/cooling/coolingState.ts`):**
- `computeCoolingUntil(from, value, unit)` turns a chosen period into a deadline.
  Units are minutes / hours / days / weeks (the user picks, e.g. "1d" default).
- `getCoolingStatus(item, now)` derives the live status purely from the
  timestamp: if `status !== 'COOLING'` it's terminal; otherwise it's `COOLING`
  while `coolingUntil > now`, else `READY_TO_RESOLVE`. **No client timer is ever
  the source of truth** — a comment in the file states this explicitly.
- `getRemainingMs` drives the countdown UI; the countdown is isolated into a
  memoized leaf component so 20 cards don't each re-render every second
  (commit `945d0e5`, "optimize countdown display with memoized components").
- **Resolution flow:** Buy / Skip / Snooze. Snooze re-cools the item. The flow
  is optimistic (commit `03370e2`, "optimistic item handling") so the UI updates
  instantly and reconciles with the server in the background.

**The payoff math (`src/core/savings/savings.ts`):**
- `computeSavedCents` = sum of all SKIPPED item amounts (the hero number).
- `summarizeSkipped` is a **single-pass aggregation** that walks the skipped
  list once to build a per-day bucket map, then derives every chart series
  (cumulative-by-day, raw-by-day, this-month total) from that map — it replaced
  five separate passes that ran on the dashboard. Timezone-correct via
  `Intl.DateTimeFormat`.
- `computeSavingsStreak` counts consecutive save-days ending today, but skips
  *today* if it's still empty so an incomplete day doesn't break a streak.
- `computeSkipRate` = skipped / (skipped + bought), as a 0–100 integer.

**Time-cost engine (`src/core/timecost/timeCost.ts`):** `WEEKS_PER_MONTH =
365.25 / 12 / 7`; SIMPLE mode = monthly income ÷ monthly work hours; TRUE_HOURLY
subtracts commute hours (×5 workdays) and work costs to get an effective wage.
`formatHours` renders "< 1 min" / "45 min" / "6h 40min" / "1.5 days (36h)".

**Milestones (`src/core/milestones/milestones.ts`):** seven thresholds — First
pause, Four-figure club (RM 1,000), Patient one (cool 7 days), More than half
(>50% skip rate, gated until 5+ decisions), Saved together (join a group
proposal), Ten in the bank, Five-figure horizon (RM 5,000). Includes "gated"
milestones that show a prerequisite label instead of progress, and a "next up"
selector (closest-to-complete non-gated locked milestone).

### B. Group Splitting & Settle-up

**Data model.** `Group` → `GroupMember` (with `InviteStatus` PENDING/ACTIVE) →
`Expense` (`type` INSTANT | PROPOSAL; `status` COOLING | COMMITTED | CANCELLED)
→ `ExpenseShare` (per real user, optional `reaction` IN/SKIP). Non-account
participants are `GuestMember` + `GuestExpenseShare`.

**Splitting (`src/core/debt/groupBalances.ts`):**
- `equalSplit(amountCents, memberIds, payerId)` floors the per-head share and
  **assigns the rounding remainder to the payer**, so cents always reconcile.
- **Guests as first-class debt nodes — the interesting bit.** A guest is encoded
  in the debt graph as `guest:${guestId}` rather than folded into the sponsor.
  Why: if you pay for an expense and split it with *your own* guest, the
  sponsor's credit and the guest's debt would net to zero on every side, and the
  settle page would wrongly say "everyone is even" — hiding the exact flow the
  user wants to see. Encoding the guest as its own node keeps that debt visible;
  it's resolved back to a real `userId` only at settle-time.

**Balances & settlement:**
- `computeBalances(expenses)` produces a net-balance map (positive = others owe
  them, negative = they owe), with guests as their own nodes.
- `settlementPlan` flattens expenses into raw debts and feeds
  **`simplifyDebts` (`src/core/debt/simplifyDebts.ts`)** — a greedy minimum-cash-
  flow algorithm: (1) compute each person's net balance, (2) split into
  creditors and debtors sorted by magnitude, (3) repeatedly match the largest
  creditor with the largest debtor, emitting a payment for `min(credit, debt)`
  until everyone nets to zero. This yields **the fewest transfers** to settle the
  group (e.g. "potato pays Arkanaganteng RM 40.25").
- The settle-up screen shows a **"How we got there" evidence trail** of the
  underlying expenses, and is **scoped** — you can only confirm the payment rows
  that involve you; others mark theirs (commit `7c0ae1d`).

**Cooling proposals for groups.** An `Expense` of `type = PROPOSAL` lets a group
cool on a shared purchase: members react IN/SKIP (`ExpenseShare.reaction`), and
the proposal is committed or cancelled — the solo cooling idea applied to
collective spending.

---

## 4. Challenges faced (from commit history + code comments + audit)

**Prisma 7 didn't deploy → downgraded to Prisma 5 (early blocker).** Commits
`6c8550a` "downgrade to Prisma 5" and `20064fd` "ci: trigger redeploy with Prisma
5 fix". The initial scaffold used a Prisma version that wouldn't build/run on
the Vercel target; pinning to Prisma 5 unblocked deploys.

**Performance: 4–5 second page loads.** The dominant root cause, per the audit,
was a **function ↔ database geography mismatch** — Vercel Functions defaulted to
a US region while the Supabase database is in Sydney, so every page paid a
cross-region round-trip (×2–5 queries) on top of cold start. Fixes layered in:
- **Region pinning** to `syd1` (`vercel.json`) to co-locate with Supabase — the
  single biggest win.
- **`unstable_cache` cross-request caching** with tag invalidation (commit
  `64081bc` "unstable_cache cross-request caching, instant group nav").
- **`staleTimes`** router-cache tuning in `next.config.ts` so back-navigation
  reuses recent renders.
- **`loading.tsx` skeletons** at every route segment + Suspense-streamed sections
  for instant paint on click.
- **Client-side filtering** for instant cooling-tab switching (commit `f620a54`).
- **Aggregate queries instead of full-row fetches** in the dashboard hero, and a
  **nav-latency pass + design-token extraction** (commit `de6929e`).
- **Optimistic UI** on mutations so clicks feel immediate.

**Date serialization crashes (RSC → client boundary).** Passing `Date` objects
across the server/client boundary caused crashes/desync. Multiple fixes:
`47d3454` "fix date serialization crash," `64081bc` "Date serialization safety,"
`e0f972c` "coerce `resolvedAt` to Date before assigning to `unlockedAt`."

**Auth / OAuth edge cases (a recurring theme).**
- **Email collisions across providers** — signing up with email/password then
  later with Google (or vice versa) on the same email. An early implementation
  *deleted* the prior account's groups/expenses on collision; that destructive
  path was removed and replaced with a thrown `AccountEmailCollisionError` that
  signs the user out of the unverified session and surfaces a recoverable error
  (commit `6e97807`; the SQL trigger `handle_new_user` also handles the conflict).
- **OAuth code-verifier cookie mistaken for a live session** caused a redirect
  loop (`56ddfee`).
- **Network timeouts mis-reported as "Not authenticated"** (`e459f9f`).
- **OAuth `redirectTo` derived from the request host, not `NEXT_PUBLIC_APP_URL`**
  so preview/prod domains work (`aeb39b4`); plus open-redirect rejection on the
  callback `next` param.

**CI pipeline fix.** The app lives in a nested `Settle/` subdirectory, which
broke the GitHub Actions workflow until the `working-directory` and
`cache-dependency-path` were corrected (`196a64b`). CI runs `tsc` + Vitest +
ESLint (`.github/workflows/check.yml`).

**RLS setup in Supabase.** RLS is enabled on every user-facing table via a
manually-run `prisma/rls.sql`, which also installs the `handle_new_user`
`SECURITY DEFINER` trigger (creates the `User` row on signup) and a
deny-by-default policy on the server-only `RateLimit` table. The subtlety: the
**Prisma runtime connection is the Postgres owner and bypasses RLS**, so RLS does
*not* constrain app traffic — it's defense-in-depth for direct REST/Realtime via
the anon key. Authorization therefore had to be enforced 100% in server actions
(`getCurrentUser()` + guards like `requireActiveMembership`,
`requireExpenseMutator`). A later audit pass added RLS to the guest tables and
hardened this story.

**Realtime integration.** Live updates use Supabase `postgres_changes`. Non-
obvious problems solved:
- **DELETE/UPDATE events didn't match column filters** until tables were set to
  `REPLICA IDENTITY FULL` (done in `prisma/realtime.sql`, alongside adding tables
  to the `supabase_realtime` publication).
- **Duplicate channels on remount** — a module-level refcount map in
  `useGroupRealtime` prevents opening multiple channels for the same group
  (commit `945d0e5` mentions the refcount; `30` in the old backlog).
- **Two overlapping hooks** — a global `useAppRealtime` (Item by userId,
  GroupMember by userId, Expense per active group) and a per-group
  `useGroupRealtime`; `Expense` was made the global hook's sole responsibility to
  avoid double `router.refresh()`.
- **Known gap:** `ExpenseShare` has no `groupId` column, so other users'
  reactions can't be filtered for and don't live-update — accepted trade-off.

**Guests as full participants.** Modeling non-account members so their debts
appear correctly in settlement (the `guest:${id}` node trick above) took a few
iterations: `0647120` "guests as full participants," `6243920` "enhance guest
handling in group settlements," `ddf5d8f` "guest-only split, resplit guards."

**Security hardening (audit-driven).** Rate limiting on abuse-prone endpoints,
an upper bound on `amountCents`, the float→cents precision fix, CSV formula-
injection escaping, magic-byte avatar validation, OAuth avatar-URL allowlisting,
secret redaction in logs, and security headers (CSP currently Report-Only).

---

## 5. What would be improved with more time

Specific and realistic, pulled from `docs/ROADMAP.md`, `docs/AUDIT.md`, and code
comments:

- **Prisma migration history.** Schema is currently driven by `prisma db push` +
  manual `rls.sql`; there's no `prisma/migrations/` to replay, which is risky for
  production rollbacks. Initialize `migrate` and commit the migration folder.
- **Cursor pagination + SQL-side balance aggregation.** `/groups` deep-fetches
  expenses (interim 200-row cap, `GROUP_EXPENSE_PAGE_SIZE`), and
  `findAllByUserCached` pulls every item for a user to partition in JS. Both
  scale poorly; move to cursor pagination and compute balances with SQL `SUM`.
- **Migrate `unstable_cache` → Next 16 Cache Components (`'use cache'`).** ~18
  call sites; deferred because it needs its own QA pass on revalidation behavior.
- **Enforce the CSP.** It currently ships as `Content-Security-Policy-Report-Only`
  to avoid breaking the app; flip to enforcing after validating the report stream.
- **Expand server-action test coverage.** IDOR/authorization guard tests exist
  (`group-actions.guards.test.ts`); the broader action layer (the riskiest
  surface, since it *is* the auth boundary) deserves more.
- **Realtime gap:** make other users' `ExpenseShare` reactions live-update
  (needs a DB view or broadcast trigger, since the table has no `groupId`).
- **PWA / offline shell** for a native-feeling repeat-open; **tablet polish**;
  splitting the larger client shells (`profile-shell.tsx`, `groups-list-shell.tsx`)
  into server components with small client islands to cut hydration cost.
- **Product roadmap (post-launch):** native mobile via React Native (the
  framework-free `core/` ports directly), per-person private time-cost inside
  groups, smart cooling-period suggestions (longer cooling when an item is a
  large share of income), receipt OCR for instant splits, and pattern insights
  (most-tempted categories / times of day).

---

## 6. How to run the app (from scratch)

**Prerequisites:** Node.js 20+, a Supabase project (Postgres + Auth + Storage),
optionally a Vercel account.

```bash
# 1. Install dependencies (postinstall runs `prisma generate`)
npm install

# 2. Create the env file and fill it in
cp .env.example .env.local
```

Required environment variables (the app won't boot without the first five):
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (client-safe)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — anon/publishable key (client-safe)
- `DATABASE_URL` — **transaction** pooler, port `6543`,
  `?pgbouncer=true&connection_limit=1` (used by Prisma Client at runtime)
- `DIRECT_URL` — **session** pooler / direct, port `5432` (used by `db push`)
- `NEXT_PUBLIC_APP_URL` — OAuth/email redirect base (e.g. `http://localhost:3000`)
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**; required for account deletion +
  avatar uploads. Never prefix `NEXT_PUBLIC_`.
- `CRON_SECRET` — optional; protects the production rate-limit cleanup cron.

```bash
# 3. Push the schema to your Supabase database
npx prisma db push

# 4. In Supabase → SQL Editor, run prisma/rls.sql  (trigger + RLS policies)
# 5. In Supabase → SQL Editor, run prisma/realtime.sql  (publication + REPLICA IDENTITY FULL)

# 6. Start the dev server → http://localhost:3000
npm run dev

# Other commands
npm test          # Vitest unit tests (core/ modules + groups repo + guards)
npm run build     # production build
```

**Production (Vercel), the non-obvious bits:** set all env vars in Project
Settings (service-role key scoped to Production only); `vercel.json` pins
functions to `syd1` to match the Supabase region — change it if your DB is
elsewhere; configure Supabase Auth URL config + Google OAuth redirect URI; run
`rls.sql` and `realtime.sql` against the prod DB; ensure a public-read `avatars`
storage bucket exists. Full checklist in `docs/SETUP.md`.
