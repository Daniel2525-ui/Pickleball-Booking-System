-- Pricing history: each price save records who made it and the prices before and after, so the owner can see
-- who changed a rate and what it was. Written only inside save_pricing_settings; staff can read it, nobody edits it.
-- save_pricing_settings body otherwise unchanged from 20261029062941.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pricing_changes (
  id bigserial PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL
);

ALTER TABLE public.pricing_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_changes_admin_read ON public.pricing_changes;
CREATE POLICY pricing_changes_admin_read ON public.pricing_changes
  FOR SELECT TO authenticated
  USING (public.is_admin());
REVOKE ALL ON public.pricing_changes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pricing_changes FROM authenticated;

-- The price list in the shape the admin page uses (settings + peakRates), so the page can describe a change
CREATE OR REPLACE FUNCTION public.pricing_snapshot()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'settings', (SELECT jsonb_build_object('base_hourly_rate', base_hourly_rate, 'min_hours', min_hours, 'max_hours', max_hours)
                 FROM public.booking_settings WHERE id),
    'peakRates', coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'label', label, 'days', to_jsonb(days),
                    'start_time', to_char(start_time, 'HH24:MI'), 'end_time', to_char(end_time, 'HH24:MI'),
                    'hourly_rate', hourly_rate) ORDER BY start_time, label)
                  FROM public.peak_rates), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.pricing_snapshot() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF coalesce(auth.role(), '') != 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_peak_rates, '[]'::jsonb)) != 'array' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_peak_rates must be a JSON array' USING ERRCODE = '22000';
  END IF;

  v_before := public.pricing_snapshot();

  -- Table CHECK constraints validate every value; a violation aborts the whole save
  UPDATE public.booking_settings
  SET base_hourly_rate = p_base_hourly_rate,
      min_hours = p_min_hours,
      max_hours = p_max_hours,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  WHERE id;

  DELETE FROM public.peak_rates WHERE true;
  INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate)
  SELECT coalesce(r->>'label', ''),
         ARRAY(SELECT jsonb_array_elements_text(r->'days')),
         (r->>'start_time')::time,
         (r->>'end_time')::time,
         (r->>'hourly_rate')::numeric
  FROM jsonb_array_elements(coalesce(p_peak_rates, '[]'::jsonb)) AS r;

  -- Who changed what, kept with the save (nothing logged when the save changed nothing)
  v_after := public.pricing_snapshot();
  IF v_after IS DISTINCT FROM v_before THEN
    INSERT INTO public.pricing_changes (actor_id, before, after)
    VALUES ((SELECT id FROM public.profiles WHERE id = auth.uid()), v_before, v_after);
  END IF;

  RETURN jsonb_build_object(
    'base_hourly_rate', p_base_hourly_rate,
    'min_hours', p_min_hours,
    'max_hours', p_max_hours,
    'peak_rates', (SELECT count(*) FROM public.peak_rates)
  );
END;
$function$;

COMMIT;
