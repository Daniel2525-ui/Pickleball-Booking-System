"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";

/** booking_settings.day_ends_at ("HH:MM:SS"), or null while it loads; the default if it can't be read. */
export function useDayEndsAt(): string | null {
  const [dayEndsAt, setDayEndsAt] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchBookingPolicy(createClient()).then((p) => active && setDayEndsAt(p.dayEndsAt));
    return () => {
      active = false;
    };
  }, []);
  return dayEndsAt;
}
