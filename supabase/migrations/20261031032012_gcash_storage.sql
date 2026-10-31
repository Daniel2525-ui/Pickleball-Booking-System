-- ==============================================================================
-- Migration: gcash_storage
-- Depends on: gcash_manual_payment; public.is_admin().
-- Description: storage buckets for GCash manual payment.
--   1. gcash-receipts (private): customers upload proof into their own <auth.uid()>/ folder;
--      only admins can read or delete (via signed URLs).
--   2. club-assets (public): holds the club GCash QR; anyone reads, only admins write.
--   Needs the Supabase `storage` schema (not applied by the plain-Postgres integration runner).
--   Idempotent: safe to re-run. Rollback: supabase/rollback_gcash_storage.sql.
-- ==============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('gcash-receipts', 'gcash-receipts', false, 5242880, '{image/jpeg,image/png,image/webp,image/heic}'),
  ('club-assets',    'club-assets',    true,  5242880, '{image/jpeg,image/png,image/webp,image/heic}')
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS gcash_receipts_insert_own ON storage.objects;
CREATE POLICY gcash_receipts_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gcash-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS gcash_receipts_select_admin ON storage.objects;
CREATE POLICY gcash_receipts_select_admin ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'gcash-receipts' AND public.is_admin());

DROP POLICY IF EXISTS gcash_receipts_delete_admin ON storage.objects;
CREATE POLICY gcash_receipts_delete_admin ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gcash-receipts' AND public.is_admin());

DROP POLICY IF EXISTS club_assets_select_all ON storage.objects;
CREATE POLICY club_assets_select_all ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'club-assets');

DROP POLICY IF EXISTS club_assets_insert_admin ON storage.objects;
CREATE POLICY club_assets_insert_admin ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'club-assets' AND public.is_admin());

DROP POLICY IF EXISTS club_assets_update_admin ON storage.objects;
CREATE POLICY club_assets_update_admin ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'club-assets' AND public.is_admin())
  WITH CHECK (bucket_id = 'club-assets' AND public.is_admin());

DROP POLICY IF EXISTS club_assets_delete_admin ON storage.objects;
CREATE POLICY club_assets_delete_admin ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'club-assets' AND public.is_admin());

COMMIT;
