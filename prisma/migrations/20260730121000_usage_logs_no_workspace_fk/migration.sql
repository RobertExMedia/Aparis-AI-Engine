-- Drop FK so usage_logs can store Supabase workspace UUIDs
ALTER TABLE "usage_logs" DROP CONSTRAINT IF EXISTS "usage_logs_workspace_id_fkey";
