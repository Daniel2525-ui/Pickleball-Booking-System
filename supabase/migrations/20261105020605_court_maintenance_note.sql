-- Court maintenance note: why a court is closed and when staff expect it back. Display only;
-- nothing reopens a court automatically. Existing policies (admin writes, public reads) cover the new columns.

BEGIN;

ALTER TABLE public.courts
  ADD COLUMN IF NOT EXISTS maintenance_note text,
  ADD COLUMN IF NOT EXISTS maintenance_until date;

ALTER TABLE public.courts DROP CONSTRAINT IF EXISTS courts_maintenance_note_length;
ALTER TABLE public.courts
  ADD CONSTRAINT courts_maintenance_note_length CHECK (char_length(maintenance_note) <= 120);

COMMIT;
