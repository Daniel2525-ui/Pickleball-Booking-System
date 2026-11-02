"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { Court } from "@/lib/services/courts/courtsTypes";
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { ScheduleTable } from "./schedule-table";
import { SessionsTable } from "./sessions-table";
import { PlayersPanel } from "./players-panel";

export interface OpenPlaySchedule {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  court_ids: string[];
  capacity: number;
  price_per_spot: number;
}

export interface OpenPlayAdminSession {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: "open" | "cancelled" | "flagged";
  flag_reason: string | null;
  booked: number;
  /** GCash payments waiting for staff; the session cannot be cancelled until they are resolved */
  awaiting: boolean;
}

/** Past its end time in Manila: cancelling would refund players for a session that already happened */
export const hasEnded = (s: Pick<OpenPlayAdminSession, "session_date" | "end_time">) =>
  new Date(`${s.session_date}T${s.end_time}+08:00`).getTime() < Date.now();

const WINDOW_DAYS = 28;

export function OpenPlayContainer() {
  const [schedules, setSchedules] = useState<OpenPlaySchedule[]>([]);
  const [sessions, setSessions] = useState<OpenPlayAdminSession[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OpenPlayAdminSession | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const load = useCallback(async () => {
    const today = new Date();
    const end = new Date(today.getTime() + WINDOW_DAYS * 86400000);
    const [sched, sess, courtRes] = await Promise.all([
      supabase.from("open_play_schedules").select("*").eq("active", true),
      supabase
        .from("open_play_sessions")
        .select("id, session_date, start_time, end_time, capacity, status, flag_reason")
        .gte("session_date", formatManilaDate(today))
        .lte("session_date", formatManilaDate(end))
        .order("session_date")
        .order("start_time"),
      fetchCourtsData(),
    ]);
    setSchedules((sched.data ?? []) as OpenPlaySchedule[]);
    setCourts(courtRes.data);

    // Same rule as open_play_spots_taken: confirmed-type rows, plus pending rows whose hold is still running
    const ids = (sess.data ?? []).map((s) => s.id);
    const { data: spotRows, error: spotError } = ids.length
      ? await supabase
          .from("bookings")
          .select("open_play_session_id, open_play_spots, status, hold_expires_at")
          .in("open_play_session_id", ids)
          .is("court_id", null)
          .in("status", ["confirmed", "checked_in", "in_progress", "completed", "pending"])
      : { data: [], error: null };
    // Without spot rows the counts read 0 and the GCash-awaiting guard on Cancel is off: say so
    if (sched.error || sess.error || courtRes.error || spotError) toast.error("Failed to load open play. Refresh before changing anything.");
    const booked = new Map<string, number>();
    const awaiting = new Set<string>();
    for (const r of spotRows ?? []) {
      if (r.status === "pending" && r.hold_expires_at === "infinity") awaiting.add(r.open_play_session_id);
      // shortcut: a pending hold counts until hold_expires_at, ignoring the short release grace period; fine for a staff overview
      if (r.status === "pending" && r.hold_expires_at && r.hold_expires_at !== "infinity" && new Date(r.hold_expires_at) < new Date()) continue;
      booked.set(r.open_play_session_id, (booked.get(r.open_play_session_id) ?? 0) + (r.open_play_spots ?? 0));
    }
    const rows = (sess.data ?? []).map((s) => ({ ...s, booked: booked.get(s.id) ?? 0, awaiting: awaiting.has(s.id) })) as OpenPlayAdminSession[];
    setSessions(rows);
    setSelected((cur) => rows.find((s) => s.id === cur?.id) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state after its awaits
    load();
  }, [load]);

  const askCancel = (session: OpenPlayAdminSession) =>
    setConfirmRequest({
      title: "Cancel this session?",
      description: "Everyone who booked is cancelled and card payments are refunded. This cannot be undone.",
      confirmLabel: "Cancel session & refund everyone",
      onConfirm: async () => {
        const res = await fetch("/api/admin/open-play/sessions/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return toast.error(body.error ?? "Could not cancel the session.");
        toast.success("Session cancelled. Card payments are being refunded.");
        load();
      },
    });

  return (
    <>
      <ScheduleTable schedules={schedules} courts={courts} loading={loading} onChanged={load} />
      <SessionsTable sessions={sessions} loading={loading} selectedId={selected?.id} onPlayers={setSelected} onCancel={askCancel} />
      {selected && (
        <PlayersPanel key={selected.id} session={selected} onCancel={askCancel} onChanged={load} />
      )}
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </>
  );
}
