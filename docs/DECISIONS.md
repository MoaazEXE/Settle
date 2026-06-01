# Design Decisions

The notable technical decisions behind Settle and the reasoning for each. These
are the "why" notes that complement the structural overview in
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Money as integer cents
All monetary values are stored and computed as integer cents — never floats.
User input is parsed by `parseAmountToCents` (`src/lib/money.ts`), which
validates against a strict `^\d+(\.\d{1,2})?$` shape and assembles cents from
the integer and decimal parts separately. This avoids the locale- and
edge-case-fragility of `Math.round(parseFloat(x) * 100)` (e.g. `1.005`, `"1,50"`).

## Cooling is computed, not counted
An item's status (`COOLING` / ready to resolve) is derived from
`coolingUntil > now()` on every read, not tracked by a client timer or a stored
flag. Closing a tab, sleeping a phone, or missing a tick can't desync the state
— the timestamp is the single source of truth.

## Savings totals are derived, never stored
The headline "money you didn't spend" is the sum of SKIPPED items computed on
read, not a column that gets incremented. Derived-on-read means the number is
always correct by construction and can never drift from the underlying records.

## Core logic is framework-free
`src/core/` has zero Next.js or Prisma imports. The cooling state machine, debt
simplification, time-cost engine, and savings math are pure functions. This
keeps them trivially unit-testable and portable — the same logic could back a
future React Native client with no changes.

## <a name="auth-boundary"></a>The server action is the auth boundary, not RLS
Every Prisma query runs over the connection in `DATABASE_URL`, which connects as
the Postgres owner — so `auth.uid()` is never set and **Row-Level Security does
not constrain application traffic**. Authorization is therefore enforced 100% in
the server actions: each calls `getCurrentUser()` and then a guard
(`requireActiveMembership`, `requireExpenseMutator`, …).

RLS is still enabled on every table as **defense-in-depth**: it's the safety net
for any direct REST or Realtime access via the anon key, so client code can
never accidentally do an end-run around the app layer. This split is documented
so it's never mistaken for the primary boundary.

## JWT-verified auth on every request
`getCurrentUser()` calls `supabase.auth.getUser()` (which verifies the token
with Supabase) rather than decoding the cookie locally with `getSession()`. A
stale or forged cookie fails on every server render. The call is wrapped in
React `cache()`, so a request pays the network cost exactly once regardless of
how many components ask.

## Email collisions never destroy data
When the same email signs in under a different auth provider (e.g. email/password
then Google), the handler throws `AccountEmailCollisionError` and the caller
signs the user out of the unverified session and surfaces a recoverable error.
An earlier implementation deleted the prior account's groups and expenses on
collision — that destructive path was removed entirely. Sign-in never deletes
user data as a side effect.

## <a name="region"></a>Region pinning for latency
Vercel Functions are pinned to `syd1` (`vercel.json`) to co-locate with the
Supabase region. Without this, functions default to a US region while the DB is
in Sydney, adding a cross-region round-trip to every query — the dominant cause
of slow page transitions. Co-locating collapses function↔DB latency to single-
digit milliseconds.

## Postgres-backed rate limiting
Abuse-prone endpoints (auth, invites, uploads, search, CSV export, item/expense
writes) go through `consume()` in `src/lib/rate-limit.ts`, backed by a single
`RateLimit` Postgres table. This avoids standing up a separate Redis/Upstash
dependency for a solo project. It fails open on DB error (logged) to avoid
locking users out during an outage, and a daily Vercel Cron prunes expired
windows.

## Security hardening
- **CSV formula injection:** export cells beginning with `= + - @` (and tab/CR)
  are prefixed with `'` so spreadsheets don't evaluate them as formulas.
- **Avatar uploads** are verified by magic bytes (JPEG/PNG/WEBP), not trusted
  file extensions or client content types.
- **OAuth avatar URLs** are validated against an allowlist of hosts before being
  stored, closing an SSRF/phishing surface.
- **Open-redirect** on the OAuth callback `next` param is rejected unless it's a
  same-origin path.
- **Secrets in logs** are redacted by key pattern before structured logging.
- **Security headers** (X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy) are enforced; a Content-Security-Policy ships in
  Report-Only mode pending validation against live traffic.

## Deliberate non-goals (for the challenge timeline)
- **No Prisma migration history** — schema is driven by `prisma db push` +
  `rls.sql`. A solo project with no rollback pipeline; migrations are a
  post-launch item.
- **No dark mode** — out of scope for the deadline.
- **No premature pagination/perf rework** beyond an interim 200-row cap on the
  heaviest query; the app is fast enough at demo scale.

A fuller record of findings, severities, and resolutions lives in
[AUDIT.md](./AUDIT.md).
