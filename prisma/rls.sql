-- =============================================================================
-- Spnd — Row Level Security + Auth Trigger
-- Run this once in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger: auto-create a User row when someone signs up via Supabase Auth
--    SECURITY DEFINER lets it bypass RLS for the insert.
--    SET search_path prevents search-path injection.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public."User" (id, name, email)
  VALUES (
    new.id::text,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
EXCEPTION WHEN unique_violation THEN
  -- Same email via different auth provider — row already exists, safe to ignore
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. Enable RLS on every user-owned table
-- -----------------------------------------------------------------------------
ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Item"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Group"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupMember"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseShare"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestMember"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestExpenseShare"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimit"          ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. User table
--    A user can only read and write their own profile row.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_self_all" ON "User";
CREATE POLICY "user_self_all" ON "User"
  FOR ALL
  USING     (auth.uid()::text = id)
  WITH CHECK (auth.uid()::text = id);

-- -----------------------------------------------------------------------------
-- 4. Item table
--    Users can only access items they own (userId = their auth UUID).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "item_owner_all" ON "Item";
CREATE POLICY "item_owner_all" ON "Item"
  FOR ALL
  USING     (auth.uid()::text = "userId")
  WITH CHECK (auth.uid()::text = "userId");

-- -----------------------------------------------------------------------------
-- 5. Group table
--    Creators have full access to groups they created.
--    Any group member (via GroupMember) can read the group.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "group_creator_all" ON "Group";
CREATE POLICY "group_creator_all" ON "Group"
  FOR ALL
  USING     (auth.uid()::text = "createdBy")
  WITH CHECK (auth.uid()::text = "createdBy");

DROP POLICY IF EXISTS "group_member_select" ON "Group";
CREATE POLICY "group_member_select" ON "Group"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "GroupMember"
      WHERE "GroupMember"."groupId" = "Group".id
        AND "GroupMember"."userId" = auth.uid()::text
    )
  );

-- -----------------------------------------------------------------------------
-- 6. GroupMember table
--    Users can manage their own membership row.
--    Any member of a group can see who else is in it.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "group_member_self_all" ON "GroupMember";
CREATE POLICY "group_member_self_all" ON "GroupMember"
  FOR ALL
  USING     (auth.uid()::text = "userId")
  WITH CHECK (auth.uid()::text = "userId");

DROP POLICY IF EXISTS "group_member_peer_select" ON "GroupMember";
CREATE POLICY "group_member_peer_select" ON "GroupMember"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "GroupMember" gm2
      WHERE gm2."groupId" = "GroupMember"."groupId"
        AND gm2."userId" = auth.uid()::text
    )
  );

-- -----------------------------------------------------------------------------
-- 7. Expense table
--    Group members can read expenses for groups they belong to.
--    Only the payer can insert an expense (and must be a group member).
--    Only the payer can update their own expense.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "expense_member_select" ON "Expense";
CREATE POLICY "expense_member_select" ON "Expense"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "GroupMember"
      WHERE "GroupMember"."groupId" = "Expense"."groupId"
        AND "GroupMember"."userId" = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "expense_payer_insert" ON "Expense";
CREATE POLICY "expense_payer_insert" ON "Expense"
  FOR INSERT
  WITH CHECK (
    auth.uid()::text = "payerId"
    AND EXISTS (
      SELECT 1 FROM "GroupMember"
      WHERE "GroupMember"."groupId" = "Expense"."groupId"
        AND "GroupMember"."userId" = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "expense_payer_update" ON "Expense";
CREATE POLICY "expense_payer_update" ON "Expense"
  FOR UPDATE
  USING (auth.uid()::text = "payerId");

-- -----------------------------------------------------------------------------
-- 8. ExpenseShare table
--    Group members can see all shares for expenses in their groups.
--    Users can manage only their own share rows (reactions, etc.).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "expense_share_member_select" ON "ExpenseShare";
CREATE POLICY "expense_share_member_select" ON "ExpenseShare"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM "Expense" e
        JOIN "GroupMember" gm ON gm."groupId" = e."groupId"
       WHERE e.id = "ExpenseShare"."expenseId"
         AND gm."userId" = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "expense_share_self_write" ON "ExpenseShare";
CREATE POLICY "expense_share_self_write" ON "ExpenseShare"
  FOR ALL
  USING     (auth.uid()::text = "userId")
  WITH CHECK (auth.uid()::text = "userId");

-- -----------------------------------------------------------------------------
-- 9. GuestMember table
--    Any active member of the host group can see the group's guests.
--    Only the user who added a guest, or the group owner, can mutate it.
--    (Application enforces the same rule in groupsRepo.removeGuestMember —
--    these policies are defense in depth in case anon traffic ever reaches the
--    table via PostgREST or realtime subscriptions.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "guest_member_select" ON "GuestMember";
CREATE POLICY "guest_member_select" ON "GuestMember"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "GroupMember"
      WHERE "GroupMember"."groupId" = "GuestMember"."groupId"
        AND "GroupMember"."userId" = auth.uid()::text
        AND "GroupMember"."status" = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "guest_member_insert" ON "GuestMember";
CREATE POLICY "guest_member_insert" ON "GuestMember"
  FOR INSERT
  WITH CHECK (
    auth.uid()::text = "addedBy"
    AND EXISTS (
      SELECT 1 FROM "GroupMember"
      WHERE "GroupMember"."groupId" = "GuestMember"."groupId"
        AND "GroupMember"."userId" = auth.uid()::text
        AND "GroupMember"."status" = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "guest_member_delete" ON "GuestMember";
CREATE POLICY "guest_member_delete" ON "GuestMember"
  FOR DELETE
  USING (
    auth.uid()::text = "addedBy"
    OR EXISTS (
      SELECT 1 FROM "Group"
      WHERE "Group".id = "GuestMember"."groupId"
        AND "Group"."createdBy" = auth.uid()::text
    )
  );

-- -----------------------------------------------------------------------------
-- 10. GuestExpenseShare table
--     Members of the host group can read; no anon writes allowed
--     (the server creates guest shares atomically with the parent expense
--     using the service role).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "guest_expense_share_member_select" ON "GuestExpenseShare";
CREATE POLICY "guest_expense_share_member_select" ON "GuestExpenseShare"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM "Expense" e
        JOIN "GroupMember" gm ON gm."groupId" = e."groupId"
       WHERE e.id = "GuestExpenseShare"."expenseId"
         AND gm."userId" = auth.uid()::text
         AND gm."status" = 'ACTIVE'
    )
  );

-- -----------------------------------------------------------------------------
-- 11. RateLimit table
--     Server-only counter; no anon access at all. RLS-on + no policy = deny
--     everything for non-service-role connections, while the Prisma server
--     connection (the only writer) bypasses RLS as the Postgres owner.
-- -----------------------------------------------------------------------------
-- (Intentionally no policies — deny by default.)
