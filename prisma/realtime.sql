-- =============================================================================
-- Settle — Realtime enablement
-- Run this once in: Supabase Dashboard → SQL Editor
-- Idempotent: safe to re-run.
--
-- Powers the live UI (notification bell, dashboard, cooling, groups). The
-- browser subscribes via @supabase/ssr, so RLS SELECT policies (see rls.sql)
-- authorize which change events each user receives.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add the tables the client subscribes to into the realtime publication.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['Item','Expense','GroupMember','GuestMember','ExpenseShare']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. REPLICA IDENTITY FULL — without it the replicated row for UPDATE/DELETE
--    carries only the primary key, so column filters (userId/groupId) can't
--    match and delete events (removed invite, deleted item) are missed.
-- -----------------------------------------------------------------------------
alter table public."Item"         replica identity full;
alter table public."Expense"      replica identity full;
alter table public."GroupMember"  replica identity full;
alter table public."GuestMember"  replica identity full;
alter table public."ExpenseShare" replica identity full;
