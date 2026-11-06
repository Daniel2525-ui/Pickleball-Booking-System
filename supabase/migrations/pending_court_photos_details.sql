-- Migration: court_photos_details
-- A photo and a one-line details text per court, shown on the landing page "Our courts" section.
-- Staff (owner and front desk, public.is_admin()) upload photos to the public court-photos bucket.
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE public.courts ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.courts ADD COLUMN IF NOT EXISTS details text;
ALTER TABLE public.courts DROP CONSTRAINT IF EXISTS courts_details_length;
ALTER TABLE public.courts ADD CONSTRAINT courts_details_length CHECK (char_length(details) <= 80);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('court-photos', 'court-photos', true, 5242880, '{image/jpeg,image/png,image/webp}')
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS court_photos_select_all ON storage.objects;
CREATE POLICY court_photos_select_all ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'court-photos');

DROP POLICY IF EXISTS court_photos_insert_staff ON storage.objects;
CREATE POLICY court_photos_insert_staff ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'court-photos' AND public.is_admin());

DROP POLICY IF EXISTS court_photos_update_staff ON storage.objects;
CREATE POLICY court_photos_update_staff ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'court-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'court-photos' AND public.is_admin());

DROP POLICY IF EXISTS court_photos_delete_staff ON storage.objects;
CREATE POLICY court_photos_delete_staff ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'court-photos' AND public.is_admin());

COMMIT;
