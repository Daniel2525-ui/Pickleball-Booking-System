"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

let channels = 0;

/**
 * Calls `onChange` whenever a booking or payment this user may read changes (Supabase realtime, so RLS applies:
 * players hear about their own rows, staff about all). A burst of changes, like a whole basket, refreshes once.
 * The tables must be in the supabase_realtime publication (migration 20261106032243_realtime_bookings_payments.sql).
 */
export function useLiveRefresh(onChange: () => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), 500);
    };
    // Each screen needs its own channel name; a counter works where crypto.randomUUID doesn't (plain-http LAN testing)
    const channel = supabase.channel(`live-refresh-${++channels}`);
    for (const table of ["bookings", "payments"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    // Join with the signed-in user's token: a join before the session loads goes in as a guest, and RLS then
    // filters out every row, so nothing ever arrives
    let active = true;
    supabase.realtime.setAuth().finally(() => active && channel.subscribe());
    return () => {
      active = false;
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);
}
