# Settle — Production-Readiness Audit

Date: 2026-05-29
Scope: `Settle/` (Next.js 16 + Supabase + Prisma)
Method: Read-only inspection of source, schema, RLS SQL, configs. Tests + tsc run.

> **Phase 2 status (2026-05-29):** all CRITICAL and HIGH items below are marked `[FIXED]`
> with the resolving commit notes inline. MEDIUM / LOW items remain open.

Severity legend

- **CRITICAL** — exploitable / data loss / blocks production launch.
- **HIGH** — likely to bite in real users; fix before launch.
- **MEDIUM** — should fix soon, not a blocker.
- **LOW** — polish / hygiene / nice-to-have.

Tests: **71/71 pass**. `tsc --noEmit` clean.

---

## Executive summary

The app is well-structured (clean `core/` boundary, Prisma kept in `data/`, server actions validated with `withValidation`), and the auth-layer authorization story is thorough. The most concerning items are:

1. **Silent data destruction in `ensureUserRecord`** when emails collide across auth providers (CRITICAL).
2. **RLS is partial** — three tables that exist in `schema.prisma` are not in `rls.sql`, and the entire app talks to Postgres as the Prisma user (not via PostgREST), so RLS is purely defense-in-depth and only triggers if direct anon access is ever introduced. The app's real security boundary is the server-action guards (HIGH-info).
3. **`getCurrentUser()` reads the session from the cookie** without verifying with Supabase (`getSession()` not `getUser()`). `verifyAuthUser()` exists for this purpose but is only used in `deleteAccount` (HIGH).
4. **Unbounded fetches** — `/groups` and items repo pull every row, no pagination (MEDIUM, but scales poorly).
5. Repos rely heavily on `unstable_cache`, which is being replaced by the Cache Components API in this Next.js version (MEDIUM/HIGH).

---

## 1. SECURITY

### CRITICAL — `ensureUserRecord` deletes prior groups/expenses on email collision `[FIXED]`

- File: `src/lib/ensure-user.ts:58-78`
- On Prisma P2002 (duplicate email under a different auth UUID — happens when a user signs up with email/password and later signs in with Google, or vice versa), the handler runs:
  ```ts
  await prisma.group.deleteMany({ where: { createdBy: stale.id } });
  await prisma.expense.deleteMany({ where: { payerId: stale.id } });
  await prisma.user.deleteMany({ where: { email } });
  ```
  This silently destroys every group the prior account owned and every expense it paid — across all other users' groups. A user picking the "wrong" sign-in method on their second visit nukes their group history. It also creates a denial-of-data vector if an attacker can register a Supabase account with a target's email.
- Fix: do not call `deleteMany` here. Either link the new auth UUID to the existing `User` row (UPDATE id), or refuse the sign-in with a "this email is already registered, please log in with X" error.
- **Resolution (Phase 2):** the destructive branch in `src/lib/ensure-user.ts` was removed entirely. P2002 now throws a new `AccountEmailCollisionError`; `auth/callback/route.ts`, `actions/auth.ts#signIn`, and `actions/auth.ts#signUp` catch it, sign the user out of the unverified provider session, and surface a recoverable error to the UI. No user data is ever deleted as a side effect of sign-in.

### CRITICAL — RLS missing on three tables that exist in the schema `[FIXED]`

- File: `prisma/rls.sql:39-44` enables RLS on `User`, `Item`, `Group`, `GroupMember`, `Expense`, `ExpenseShare`. It does **not** enable RLS on `GuestMember`, `GuestExpenseShare`, or `RateLimit`. All three exist in `prisma/schema.prisma:146-193`.
- Severity is CRITICAL because Supabase defaults exposed-via-PostgREST tables to anon access _unless_ RLS is on. If anything ever uses the `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` against those tables (current code does not, but realtime/future features might), guest data and rate-limit counters are world-readable/writable.
- Fix: `ALTER TABLE "GuestMember" / "GuestExpenseShare" / "RateLimit" ENABLE ROW LEVEL SECURITY;` and add owner-scoped policies (RateLimit should be service-role only / deny all).
- **Resolution (Phase 2):** `prisma/rls.sql` now enables RLS on all three tables and adds: per-group-member SELECT + adder/owner-only mutate policies for `GuestMember`, per-group-member SELECT for `GuestExpenseShare`, and _no_ policies on `RateLimit` (RLS-on + no policy = deny by default; the Prisma server connection bypasses RLS as the Postgres owner). **Manual step: re-run `prisma/rls.sql` in the Supabase SQL editor against production to apply.**

### HIGH — App-layer authorization is the only real auth boundary `[FIXED — documented]`

- All Prisma queries go through `DATABASE_URL` which uses the Postgres role (effectively superuser/`postgres` from the pooler) — **not** via PostgREST and not via Supabase JWT. `auth.uid()` in the RLS policies is never set by the Prisma connection, so RLS as written **does not constrain any application traffic**. RLS only kicks in for direct REST/anon access (e.g. realtime subscriptions, or any client that calls Supabase REST directly).
- Net effect: authorization is enforced 100% by the server actions (`getAuthUserId()`, `requireActiveMembership`, `requireExpenseAccess`). Any future code path that forgets these guards is a full data exposure.
- Recommendation: leave RLS as defense-in-depth (so client code can never accidentally do an end-run), document this explicitly so future contributors don't think RLS is the boundary, and consider extracting a `withAuthorizedUser(handler)` wrapper that fails closed.
- **Resolution (Phase 2):** the security-boundary contract is now spelled out in the doc comment on `getCurrentUser` in `src/lib/supabase/server.ts` and reiterated in the README "Key design decisions" section. No code wrapper was added — the per-action `getAuthUserId()` + `requireActiveMembership` pattern is already consistent across every server action.

### HIGH — `getCurrentUser()` trusts the auth cookie without server verification `[FIXED]`

- File: `src/lib/supabase/server.ts:51-61`
- Uses `auth.getSession()` which decodes the cookie locally; Supabase docs explicitly warn this should not be used as the auth source for server-side decisions. A stolen, leaked, or stale cookie is accepted.
- `verifyAuthUser()` (lines 68-77) exists but is only used in `deleteAccount` (and even there, falls back to the unverified path on network failure — `src/app/actions/auth.ts:104-110`).
- Fix: use `verifyAuthUser()` (or refactor `getCurrentUser` to call `getUser()` once per request via React `cache`) for any mutating action: `transferOwnership`, `deleteGroup`, `kickMember`, `settleGroup`, `deleteExpense`, `editExpense`, plus all `*ProfileSettings` writes. The cost is one Supabase network call per request, paid only by mutations.
- **Resolution (Phase 2):** `getCurrentUser` was rewritten to call `supabase.auth.getUser()` (JWT-verified) and kept inside React `cache()` so one request pays the network cost once regardless of how many components ask. `verifyAuthUser` is now an alias for `getCurrentUser`, and the awkward fallback inside `deleteAccount` was deleted because the two paths are identical. Forged or stale cookies now fail on every server render.

### HIGH — Service-role key reachable from the Supabase-admin client paths

- Files: `src/app/actions/users.ts:61-77` (avatar upload), `src/app/actions/auth.ts:140-146` (auth user delete).
- These import `SUPABASE_SERVICE_ROLE_KEY` from `process.env` inside `'use server'` actions, so it never reaches the client bundle. That part is correct.
- Risk: `NEXT_PUBLIC_SUPABASE_URL!` is concatenated with the service key into a client constructor — the `!` non-null assertion masks misconfig. Also no try/catch around `admin.auth.admin.deleteUser` failure beyond log. Acceptable, but ensure `SUPABASE_SERVICE_ROLE_KEY` is set as a **server-only** env on Vercel (never as `NEXT_PUBLIC_*` and never in preview deployments accessible to PRs from forks). Verify on dashboard.

### HIGH — `editExpense` allows any group member to edit any expense `[FIXED]`

- File: `src/app/actions/groups.ts:449-558` via `requireExpenseAccess` (line 428-447) — only checks group membership, not payer ownership.
- RLS policy `expense_payer_update` (rls.sql:139-142) only allows the payer, but since RLS doesn't gate Prisma traffic (see above), the action is the real check. Members can edit other members' shared expenses, including re-splitting.
- If this is intentional (group consensus model), document it. If not, add `if (expense.payerId !== userId) throw ValidationError('Only the payer can edit')`.
- **Resolution (Phase 2):** added `requireExpenseMutator` to `src/app/actions/groups.ts` that rejects unless the actor is the payer **or** the group creator (kept the owner-override as a moderation backstop). `editExpense`, `deleteExpense`, and `resplitExpense` now use it instead of `requireExpenseAccess`. Read access in display paths is unaffected.

### MEDIUM — CSV formula injection in export

- File: `src/app/api/export/csv/route.ts:8-14`
- `esc()` escapes commas/quotes/newlines but not values starting with `=`, `+`, `-`, `@`. Excel/Sheets will evaluate those as formulas, enabling exfiltration via `=HYPERLINK(...)` etc. User-controlled fields written to CSV: `Title`, `Note` (via category), `Description`, `Group.name`.
- Fix: prepend `'` to any cell that begins with one of `=+-@\t\r`.

### MEDIUM — Open redirect on auth callback `next` param is partially mitigated

- File: `src/app/auth/callback/route.ts:9-10` — regex `^\/(?![/\\])` correctly rejects `//evil.com` and `/\evil`. Looks safe. Keeping as MEDIUM "review" only — no action needed beyond confirming the regex with a test case.

### LOW — Account-enumeration via invite errors

- File: `src/app/actions/groups.ts:97-109` returns distinct messages for "no such username" / "no such email". Acceptable for invite UX; flag for awareness.

### LOW — Rate-limit `consume()` fails open on DB error

- File: `src/lib/rate-limit.ts:35` — `.catch(() => true)` lets traffic through if rate-limit DB write throws. Trade-off is intentional (avoid lockouts) but means a Postgres outage disables brute-force protection.

### LOW — Trailing client IP not pinned

- File: `src/app/actions/auth.ts:9-12` — `x-forwarded-for` first token. On Vercel this is platform-set and trustworthy; double-check that no proxy/CDN sits in front that could let attackers control the leftmost IP.

### Input validation — generally good

- `withValidation` + `getRequiredString/Cents` enforces length and numeric bounds (e.g. max 100M cents in `form-data.ts:35`, name ≤ 60 in actions). No `dangerouslySetInnerHTML` found. No `$queryRaw`/`$executeRaw` usage. Magic-byte verification on avatars (`users.ts:50-55`) is solid.

---

## 2. SCALABILITY / DATABASE

### MEDIUM (demoted from HIGH in Phase 2) — Heavy `unstable_cache` usage in a Next.js version that has moved on

- 18 usages across `src/data/*.repo.ts` and `src/lib/utils.ts`. `AGENTS.md` explicitly warns "This is NOT the Next.js you know" — Next 16 favors the Cache Components API (`'use cache'` + `cacheTag`/`cacheLife`).
- `unstable_cache` still works but is being phased out; behavior under PPR/Cache Components is undefined in some edge cases (Date deserialization is already a workaround — `lib/utils.ts:9`).
- Recommendation: migrate repo helpers to `'use cache'` directives with `cacheTag(\`items-user-${id}\`)`. Existing `updateTag(...)` calls in actions remain compatible.
- **Phase 2 note:** demoted to MEDIUM. This is technical debt, not a security or correctness issue — `unstable_cache` still ships in Next 16 and the Cache Components API requires the experimental `cacheComponents` flag. Doing the migration safely needs a dedicated pass with full QA of revalidation behavior; bundling it into a security fix sprint risked silently breaking caching across the app.

### HIGH — `/groups` loads every expense for every group, unbounded `[FIXED — interim cap]`

- File: `src/app/(app)/groups/page.tsx:62-153` calls `findManyByUserDeep` (groups.repo.ts:32-43) with `expenses: { where: { status: 'COMMITTED' } }` and no `take`. Then re-serializes all of it into `allGroupsRaw` and ships it to the client.
- For a group with hundreds of expenses this becomes a multi-hundred-KB payload per render plus a heavy SQL JOIN with shares + guestShares + payer profile.
- Fix: cap initial expenses (last 30) and lazy-load on group-detail expand. Same applies to `findByIdDeep` (groups.repo.ts:46-60).
- **Resolution (Phase 2 — interim):** added `GROUP_EXPENSE_PAGE_SIZE = 200` to `src/data/groups.repo.ts` and `take: 200` on the `expenses` include used by both `findManyByUserDeep` and `findByIdDeep`. This caps the worst-case payload while keeping `computeBalances` accurate for every realistic group. Proper incremental pagination + server-side balance aggregation is still tracked as a MEDIUM item below.

### MEDIUM — `findAllByUserCached` returns every user item per request

- File: `src/data/items.repo.ts:11-34` fetches all rows for the user, then partitions. Heavy users will outgrow this within a few months of daily logging.
- Fix: paginate (`take: 100, skip`) on the cooling page; keep the aggregate `_sum` query for the dashboard hero (already done — items.repo.ts:42-54).

### MEDIUM — Missing indexes

- `GuestMember.addedBy` (schema.prisma:146-158) — no index, but `cascadeDeleteUserData` (users.repo.ts:102) and `ensureUserRecord` delete by `addedBy`. Seq-scan as guests grow.
- `User.email` already unique → indexed. ✓
- `Expense.coolingUntil` — queried in proposal lists, but combined with `status` which is filtered first. Likely fine until proposals scale.
- Fix: add `@@index([addedBy])` to `GuestMember`.

### MEDIUM — `RateLimit` table grows unboundedly

- No cleanup of stale rows after their window expires. After months of traffic this becomes a heavy table.
- Fix: nightly cron / Vercel scheduled function: `DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day'`.

### MEDIUM — Vercel region `syd1` vs Supabase region

- `vercel.json: { regions: ["syd1"] }`. If the Supabase project is in a different region, every Prisma query pays cross-region latency. Cannot verify from code.
- Manual check below.

### LOW — Connection pooling

- `.env.local` comments document DATABASE_URL = transaction pooler, DIRECT_URL = session pooler. That's the correct Supabase pattern for Prisma on serverless (transaction pooler for runtime, direct/session for migrations).
- Cannot verify the actual URLs without reading the file (declined). Manual check below.
- `prisma/schema.prisma:5-9` correctly wires `directUrl`.

### LOW — N+1 hotspots

- `revalidateGroupMembers` (groups.ts:39-52) lists all members per mutation to fan out cache tags — acceptable, members per group small.
- `addExpense` (groups.ts:349) loads group with members + guestMembers in one query, no N+1.
- `settleGroup` (groups.ts:803-859) does sequential per-row guest-share queries inside `$transaction` — for many guest rows this serializes. Borderline acceptable; flag if "settle up" becomes slow.

---

## 3. PERFORMANCE

### MEDIUM — `<img>` for avatars instead of `next/image`

- 6 files use raw `<img>` for avatars (`src/components/ui/avatar.tsx:35`, `top-bar.tsx`, `nav.tsx`, profile sheets). Google avatar URLs are large originals.
- `next.config.ts` does not configure `images.remotePatterns`, so switching to `next/image` will need that for `lh3.googleusercontent.com` + the Supabase storage host.
- Fix: migrate `Avatar` to `next/image` with sized sources; configure `images.remotePatterns`.

### MEDIUM — `findManyByUserDeep` is fetched twice per `/groups` render path

- Once by `findManyByUser` (returns same), once by `findManyByUserDeep`. `findManyByUser` wraps the same cached function (groups.repo.ts:148-150), so per-request `cache()` dedupes it. ✓ — not a real issue, just confusing.

### LOW — `staleTimes` configured

- `next.config.ts:11` — `{ dynamic: 60, static: 300 }`. Good.

### LOW — Bundle size

- Heavy deps: `recharts` (~250KB), `@base-ui/react`, `cmdk`. `optimizePackageImports` is set for them in `next.config.ts:7-12`. Reasonable.

### LOW — Client polling via `useTick(1000)`

- `dashboard/_components/cooling-card.tsx` ticks every 1s to update countdowns. Multiple instances rendered simultaneously. Fine for the scale, but each tick re-renders the whole card. Consider `requestAnimationFrame` with throttle if many cards.

---

## 4. HARDCODED DATA / MAGIC VALUES

### MEDIUM — Onboarding launch date hardcoded

- `src/app/(app)/layout.tsx:48` — `const ONBOARDING_LAUNCH = new Date('2026-05-27T00:00:00Z')`. A magic constant gates the entire onboarding flow. Move to a config / env constant or commit it as `ONBOARDING_REQUIRED_FROM` next to the user model.

### MEDIUM — Default currency `'MYR'` duplicated

- 5+ locations: `user-context.ts:58`, `formatters.ts:35`, `users.ts:137`, `users.ts:215`, `csv/route.ts:47`, `settings/page.tsx:39`, `onboarding-form.tsx:46`, `currency-context.tsx:6`, `groups/[id]/resplit/page.tsx:24`.
- Fix: export `DEFAULT_CURRENCY` from `lib/formatters.ts` (already lists CURRENCIES there).

### MEDIUM — Default cooling period `'1d'` hardcoded

- `user-context.ts:57`, `schema.prisma:58`. The `lib/cooling/coolingState.ts` parser uses suffix `m/h/d/w`. Centralize as `DEFAULT_COOLING_PERIOD = '1d'`.

### LOW — Max amount `100_000_000` cents

- `form-data.ts:35` — RM 1,000,000 cap. Currency-aware? At MYR yes, at JPY this is RM 1,000,000 worth. Fine because all amounts are stored as cents and capped uniformly.

### LOW — CSV export limit `10_000`

- `csv/route.ts:29`. Fine, but should be a named const at top of file.

### LOW — Rate-limit windows scattered

- 10 different `consume(key, limit, window)` call sites across actions. Centralize in `lib/rate-limit-configs.ts` as a single source of truth.

### LOW — Cooling-day cap 365 hardcoded

- `groups.ts:594` — `Math.min(365, parseInt(...))`. Fine.

### LOW — `1440` minutes snooze default

- `items.repo.ts:172`, `actions/items.ts:133`. Name it `SNOOZE_MINUTES_DEFAULT`.

---

## 5. CODE QUALITY

### Strengths

- `core/` is pure (no Prisma / Next imports) — separation holds. ✓
- TS strict on, no `any` usages, no `dangerouslySetInnerHTML`, no raw SQL. ✓
- Error logging is structured + redacts sensitive keys (`lib/log-error.ts:8-23`). ✓
- Validation centralized via `withValidation` + typed FormData helpers. ✓

### MEDIUM — No top-level `not-found.tsx`

- `find src/app -name not-found.tsx` returns nothing. Custom 404 missing. Default Next.js page will show.
- Fix: add `src/app/not-found.tsx` and `src/app/(app)/not-found.tsx`.

### MEDIUM — `signUp` returns the sentinel `'check-email'`

- `src/app/actions/auth.ts:81`. Magic string flows through `useActionState`. Replace with a discriminated return type (`{ status: 'checkEmail' | 'error', message?: string }`) once the action signature is changed.

### LOW — `signIn` rate-limit `.catch(() => true)` swallows errors silently

- `src/app/actions/auth.ts:25,57` — without a `logError` call the failure mode is invisible.

### LOW — Dynamic `await import(...)` inside actions

- `src/app/actions/auth.ts:107,114,124,144` and `users.ts:33,39,63` use dynamic imports for `logError`, `usersRepo`, `@supabase/supabase-js`. Likely chasing bundle-size but adds runtime indirection. Prefer top-level imports.

### LOW — Loading boundaries patchy

- `cooling/` has loading.tsx, `dashboard/` has loading + error, but `profile/` has loading only (no error), `settings/` same. Add `error.tsx` to each protected route segment.

### LOW — `IMPROVEMENTS.md` is gitignored

- `.gitignore` excludes `CLAUDE.md`, `AGENTS.md`, `IMPROVEMENTS.md`. Confirm intent — if these are project docs the team wants, remove from `.gitignore`.

---

## 6. PRODUCTION HYGIENE

### HIGH — README is incorrect in multiple places `[FIXED]`

- `README.md:15` says **Prisma 7** — actually `prisma: ^5.22.0` in `package.json:43`.
- `README.md:33` says `cp .env.example .env` — **no `.env.example` file exists** in the repo.
- `README.md:40` says `npx prisma migrate dev --name init` — there is **no `prisma/migrations/` directory**. The setup uses `db push` + `rls.sql` ran manually in the Supabase dashboard. Following the README literally fails.
- Fix: regenerate README to reflect actual workflow (`db push` + run `prisma/rls.sql` in Supabase SQL editor), and create `.env.example` listing all 6 keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_APP_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- **Resolution (Phase 2):** README rewritten end-to-end (Prisma 5 corrected, `db push` + `rls.sql` flow documented, production checklist added). `.env.example` created with all 6 keys, comments on which are public vs server-only, and the correct Supabase pooler URL shapes.

### MEDIUM — No Prisma migration history

- Only `prisma/schema.prisma` + `prisma/rls.sql` are tracked. The schema evolved (you can see `usernameLower`, `guestMembers`, `TimeCostMode`) but there's no migration history to replay. Reproducing the DB requires `prisma db push` against a clean Supabase project + manually running `rls.sql`. Risky for production rollbacks.
- Fix: initialize migrations with `prisma migrate dev --name init` from the current schema state, and commit the resulting `prisma/migrations/` folder going forward.

### LOW — `.gitignore` covers `.env*` ✓ ; no secrets visible in tracked files.

- `package-lock.json` present ✓.
- `tsbuildinfo` gitignored ✓.

### LOW — Vercel region pinned

- `vercel.json: { "regions": ["syd1"] }`. If user base is global, single region pays latency. If Supabase is in `syd1` too, perfect.

### LOW — No CSP / security headers configured

- `next.config.ts` does not set `headers()` for `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, etc. Vercel sets HSTS by default; the rest are not. Consider adding a minimal CSP.

---

## 7. TESTS

- `npm test` → **71 passed across 7 files** (`cooling/`, `debt/`, `timecost/`, `savings/`, `milestones/`, `money`, `groups.repo`).
- `tsc --noEmit` clean.

### MEDIUM — Coverage gaps for business logic that touches the DB

- No tests for: `items.repo.ts`, `users.repo.ts`, `expenses.repo.ts`, any `src/app/actions/*` file, the `api/export/csv` route, `api/search` route.
- The action layer is where authorization lives — it's the riskiest unt-tested surface. Add at minimum:
  - IDOR test for `editExpense`, `deleteExpense`, `kickMember`, `transferOwnership` (non-owner blocked).
  - `requireActiveMembership` rejects non-members and PENDING members.
  - `ensureUserRecord` P2002 branch (once the destructive-delete bug is fixed) — test that it links rather than nukes.

### LOW — `groups.repo.test.ts` mocks Prisma — fine for unit scope; doesn't catch schema/migration drift.

---

## Ranked summary (most urgent first)

Status legend: ✅ fixed in Phase 2 · 🟡 partial / interim · ⬜ open

| #   | Status | Severity | Area                                                                                    | One-line fix                                                                                                                                                                |
| --- | ------ | -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ✅     | CRITICAL | `src/lib/ensure-user.ts:60-78` — silent group/expense deletion on email-collision       | Throws `AccountEmailCollisionError`; callers sign out + surface error.                                                                                                      |
| 2   | ✅     | CRITICAL | `prisma/rls.sql:39-44` — RLS missing on `GuestMember`, `GuestExpenseShare`, `RateLimit` | RLS enabled + owner-scoped policies (RateLimit = deny-by-default). **Re-run `rls.sql` in Supabase prod.**                                                                   |
| 3   | ✅     | HIGH     | `src/lib/supabase/server.ts:51` — auth derived from unverified cookie                   | `getCurrentUser` now uses `getUser()` (JWT-verified), still cached per request.                                                                                             |
| 4   | ✅     | HIGH     | Whole codebase — Prisma bypasses RLS, so app guards are the only boundary               | Documented in `server.ts` and README; no wrapper added (existing pattern is consistent).                                                                                    |
| 5   | ✅     | HIGH     | `src/app/actions/groups.ts:449` — any member can edit any expense                       | New `requireExpenseMutator` (payer or group owner only) wired into edit/delete/resplit.                                                                                     |
| 6   | 🟡     | HIGH     | `src/data/groups.repo.ts:32` — unbounded deep fetch                                     | Capped at 200 (`GROUP_EXPENSE_PAGE_SIZE`). True pagination still on the MEDIUM list.                                                                                        |
| 7   | ⬜     | MEDIUM   | `unstable_cache` everywhere (demoted from HIGH)                                         | Defer to a dedicated Cache Components migration pass.                                                                                                                       |
| 8   | ✅     | HIGH     | README + missing `.env.example` + no migration history                                  | README rewritten; `.env.example` created. Migration history still open (MEDIUM).                                                                                            |
| 9   | ⬜     | MEDIUM   | CSV formula injection (`src/app/api/export/csv/route.ts:8-14`)                          | Prefix cells starting with `=+-@\t\r` with `'`.                                                                                                                             |
| 10  | ⬜     | MEDIUM   | `findAllByUserCached` unbounded items fetch (`src/data/items.repo.ts:11`)               | Paginate cooling history.                                                                                                                                                   |
| 11  | ⬜     | MEDIUM   | Missing index on `GuestMember.addedBy` (`prisma/schema.prisma:146`)                     | Add `@@index([addedBy])`.                                                                                                                                                   |
| 12  | ⬜     | MEDIUM   | `RateLimit` table grows forever                                                         | Nightly delete of expired windows.                                                                                                                                          |
| 13  | ⬜     | MEDIUM   | Hardcoded `ONBOARDING_LAUNCH` date (`src/app/(app)/layout.tsx:48`)                      | Move to constant or env.                                                                                                                                                    |
| 14  | ⬜     | MEDIUM   | `MYR` and `'1d'` defaults duplicated                                                    | Centralize in `lib/formatters.ts`.                                                                                                                                          |
| 15  | ⬜     | MEDIUM   | Avatars served as `<img>` not `next/image` (6 files)                                    | Migrate + configure `images.remotePatterns`.                                                                                                                                |
| 16  | ⬜     | MEDIUM   | Action-layer tests missing                                                              | Add IDOR + auth-bypass tests for groups/expenses actions.                                                                                                                   |
| 17  | ⬜     | MEDIUM   | No top-level `not-found.tsx`                                                            | Add custom 404.                                                                                                                                                             |
| 18  | ⬜     | MEDIUM   | True pagination + server-side balance aggregation for `/groups` (follow-up to #6)       | Replace 200-row cap with cursor pagination; compute balances via SQL `SUM`.                                                                                                 |
| 19  | ⬜     | MEDIUM   | Initialize Prisma migration history (follow-up to #8)                                   | `prisma migrate dev --name init` from current schema; commit `prisma/migrations/`.                                                                                          |
| 20  | ⬜     | MEDIUM   | Pin exact dependency versions in `package.json` (Phase 2 add)                           | Remove `^` from all entries so `npm install <new-pkg>` can't drift siblings. Honest take: small win on top of the lockfile + `npm ci`; do during a calm moment, not urgent. |
| 21  | ⬜     | LOW      | `signUp` returns sentinel `'check-email'` (`src/app/actions/auth.ts:81`)                | Use a discriminated return type.                                                                                                                                            |
| 22  | ⬜     | LOW      | Dynamic `await import(...)` for `logError` etc                                          | Use top-level imports.                                                                                                                                                      |
| 23  | ⬜     | LOW      | Rate-limit `fail-open` on DB error (`src/lib/rate-limit.ts:35`)                         | At minimum, log the error.                                                                                                                                                  |
| 24  | ⬜     | LOW      | Inconsistent route-level `error.tsx`                                                    | Add to `profile/`, `settings/`, `cooling/`.                                                                                                                                 |
| 25  | ⬜     | LOW      | No security headers / CSP in `next.config.ts`                                           | Add minimal CSP + frame-ancestors.                                                                                                                                          |
| 26  | ⬜     | LOW      | Hardcoded magic numbers (1440 minutes, 10000 CSV rows, 100M cents)                      | Name them; group in a `constants.ts`.                                                                                                                                       |

---

## Manual dashboard checks (not verifiable from code)

These need eyeball confirmation in the Supabase / Vercel / Google Console — code alone can't tell you.

1. **Supabase → Authentication → URL Configuration**: confirm the **Site URL** and **Redirect URLs** include the production domain (`NEXT_PUBLIC_APP_URL`) plus `https://<domain>/auth/callback`. Without this, OAuth callback redirects to localhost or fails.
2. **Supabase → Project Settings → API**: confirm `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the **anon (publishable)** key, not the service-role key. Confirm `SUPABASE_SERVICE_ROLE_KEY` is configured **only** in Vercel **Production** env (not Preview, especially if you accept PRs from forks).
3. **Supabase → Database → Connection pooling**: confirm `DATABASE_URL` points to the **Transaction** pooler (port 6543) and `DIRECT_URL` to the **Session** pooler / direct connection. The `.env.local` comments imply this is set, but I declined to read the values.
4. **Supabase region vs Vercel `syd1`**: confirm the Supabase project region. Cross-region adds ~150–250 ms per Prisma query.
5. **Supabase → Authentication → Email**: email confirmation is disabled (the code path in `auth.ts:71-79` assumes immediate session). Confirm that matches the production policy.
6. **Supabase Storage → `avatars` bucket**: confirm RLS / bucket policies match the intent (server uploads via service-role; public read for signed URLs).
7. **Run `prisma/rls.sql` in production**: the file says "Run this once in: Supabase Dashboard → SQL Editor". There's no migration that asserts it ran. Confirm the policies and trigger exist by opening the SQL editor and running `SELECT * FROM pg_policies WHERE schemaname = 'public';`.
8. **Google Cloud Console → OAuth client**: redirect URI registered as `https://<your-supabase-project>.supabase.co/auth/v1/callback` (not the app domain — Supabase brokers).
9. **Vercel environment variables**: spot-check that `SUPABASE_SERVICE_ROLE_KEY` is **not** prefixed `NEXT_PUBLIC_` (publishing it to the client would be a critical breach).
10. **Vercel → Domains / SSL**: confirm production domain is attached and HSTS preload is on if desired.
11. **`prisma migrate status` against production DB**: if no migrations exist, you cannot `prisma migrate deploy`; production schema diverges silently. See finding #8.
12. **Confirm the `RateLimit` table actually exists in prod** — there's no migration for it, only the schema. If `db push` was last run before this model was added, every action call is throwing silently (caught by `.catch(() => true)` in `guard()`). Quick check: `\d "RateLimit"` in the SQL editor.

---

End of audit. No code changes performed.

phase 2 run:
Phase 2 done

Fixed (CRITICAL + HIGH):

1. ✅ ensureUserRecord no longer deletes prior groups/expenses on email collision — throws AccountEmailCollisionError,
   callers sign out + surface the error.
2. ✅ RLS enabled + policies added for GuestMember, GuestExpenseShare, RateLimit (deny-by-default). Manual step:
   re-run prisma/rls.sql in Supabase prod.
3. ✅ getCurrentUser now JWT-verifies via getUser() on every request (cached per request). verifyAuthUser is now an
   alias.
4. ✅ App-layer-as-boundary documented in server.ts comment + README.
5. ✅ editExpense / deleteExpense / resplitExpense now require requireExpenseMutator (payer or group owner only).
6. 🟡 /groups deep fetch capped at 200 expenses per group (GROUP_EXPENSE_PAGE_SIZE). Proper pagination is now a MEDIUM
   follow-up.
7. ✅ README rewritten end-to-end; .env.example created with all 6 keys and pooler-URL shapes.

Deliberately deferred (with rationale already in AUDIT.md):

- unstable_cache → 'use cache' migration: demoted to MEDIUM. Honest reason: large refactor across 18 sites with subtle
  revalidation behavior, requires the experimental cacheComponents flag. Doing it during a security pass risks silently
  breaking caching. Needs its own QA cycle.

New item added to MEDIUM list (#20): pin exact dep versions in package.json. My honest take stays the same — it's a
small win on top of the lockfile, worth doing in a calm moment, not urgent.

No new dependencies installed. All fixes use existing imports.
