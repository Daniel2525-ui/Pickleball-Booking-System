-- Rollback for 20261105060452_pricing_history.sql: restores save_pricing_settings from 20261029062941 and drops the log

BEGIN;

CREATE OR REPLACE FUNCTION public.save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(auth.role(), '') != 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_peak_rates, '[]'::jsonb)) != 'array' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_peak_rates must be a JSON array' USING ERRCODE = '22000';
  END IF;

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

  RETURN jsonb_build_object(
    'base_hourly_rate', p_base_hourly_rate,
    'min_hours', p_min_hours,
    'max_hours', p_max_hours,
    'peak_rates', (SELECT count(*) FROM public.peak_rates)
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.pricing_snapshot();
DROP TABLE IF EXISTS public.pricing_changes;

COMMIT;
