# Setup & Deployment

Full local setup and the production checklist. The README has the quickstart;
this is the detailed reference, including the manual Supabase steps that aren't
captured in code.

## Prerequisites

- Node.js 20+
- A Supabase project (Postgres + Auth + Storage)
- (Optional) A Vercel account for deployment

## Local setup

### 1. Install dependencies
```bash
npm install
```
`postinstall` runs `prisma generate` automatically.

### 2. Configure environment
```bash
cp .env.example .env.local
```
Fill in the values. The app will not boot without these five:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_APP_URL`. `SUPABASE_SERVICE_ROLE_KEY`
is required for account deletion and avatar uploads. `CRON_SECRET` is optional
(only used by the cleanup cron in production).

Connection-string shapes (Supabase → Project Settings → Database → Connection pooling):
- `DATABASE_URL` — **transaction** pooler, port `6543`, with
  `?pgbouncer=true&connection_limit=1` (one pooled connection per reused
  function instance).
- `DIRECT_URL` — **session** pooler / direct connection, port `5432` (used by
  `prisma db push` for prepared statements and multi-statement transactions).

### 3. Push the database schema
```bash
npx prisma db push
```
Schema state is driven by `prisma/schema.prisma` + `db push`; there is no
`prisma/migrations/` history (see [DECISIONS.md](./DECISIONS.md#deliberate-non-goals-for-the-challenge-timeline)).

### 4. Apply Row-Level Security (one-time)
Run `prisma/rls.sql` once in **Supabase → SQL Editor**. It installs:
- the `handle_new_user` trigger that creates a `User` row on signup,
- RLS policies on every user-facing table,
- deny-by-default RLS on the server-only `RateLimit` table.

### 5. Enable Realtime (one-time)
Run `prisma/realtime.sql` once in **Supabase → SQL Editor**. It adds the relevant
tables to the `supabase_realtime` publication and sets `REPLICA IDENTITY FULL`
so change filters match on UPDATE/DELETE. Without this, the live-update UI won't
fire. Realtime is authorized by the RLS policies from step 4.

### 6. Run
```bash
npm run dev     # http://localhost:3000
npm test        # Vitest unit tests
npm run build   # production build
```

## Production deployment (Vercel)

1. **Environment variables** — set everything from `.env.example` in
   **Vercel → Project Settings → Environment Variables**.
   `SUPABASE_SERVICE_ROLE_KEY` must **not** carry the `NEXT_PUBLIC_` prefix and
   should be scoped to **Production** only (not Preview, if you accept PRs from
   forks). Set `CRON_SECRET` to a long random string
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
2. **Region** — `vercel.json` pins functions to `syd1` to match the Supabase
   region. If your Supabase project is elsewhere, change this to match
   (see [DECISIONS.md](./DECISIONS.md#region)).
3. **Supabase → Authentication → URL Configuration** — Site URL =
   `https://<your-domain>`; Redirect URLs include `https://<your-domain>/auth/callback`.
4. **Supabase → Authentication → Providers → Google** — client ID + secret set;
   the Google Cloud OAuth client lists
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
5. **Run `prisma/rls.sql` and `prisma/realtime.sql`** against the production
   database (verify policies with
   `SELECT * FROM pg_policies WHERE schemaname = 'public';`).
6. **Storage** — the `avatars` bucket exists and is public-read; server uploads
   use the service role.
7. **Cron** — the daily `RateLimit` cleanup
   (`/api/cron/cleanup-ratelimits`, scheduled in `vercel.json`) only runs on
   Production deployments and requires `CRON_SECRET`.
