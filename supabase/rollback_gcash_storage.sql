-- Rollback for 20261031120100_gcash_storage.sql.
-- Buckets are deleted only if empty (storage rows can't be dropped while holding objects);
-- non-empty buckets are left in place so uploaded receipts are never lost.
BEGIN;
DROP POLICY IF EXISTS gcash_receipts_insert_own ON storage.objects;
DROP POLICY IF EXISTS gcash_receipts_select_admin ON storage.objects;
DROP POLICY IF EXISTS gcash_receipts_delete_admin ON storage.objects;
DROP POLICY IF EXISTS club_assets_select_all ON storage.objects;
DROP POLICY IF EXISTS club_assets_insert_admin ON storage.objects;
DROP POLICY IF EXISTS club_assets_update_admin ON storage.objects;
DROP POLICY IF EXISTS club_assets_delete_admin ON storage.objects;
DELETE FROM storage.buckets b WHERE b.id IN ('gcash-receipts','club-assets')
  AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);
COMMIT;
