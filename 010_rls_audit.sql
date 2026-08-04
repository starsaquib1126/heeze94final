-- 010: RLS Audit — run this first to see your CURRENT permissions
-- This doesn't change anything, it just shows you what exists right now.
-- Run it in Supabase SQL Editor and share the results.

SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Then check what policies exist on each table:
SELECT
  tablename,
  policyname,
  roles,
  cmd AS applies_to,
  qual AS using_condition
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
