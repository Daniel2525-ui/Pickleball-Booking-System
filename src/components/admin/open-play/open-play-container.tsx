"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchPastSpotRows, fetchSpotRows } from "@/lib/services/openPlay/openPlayData.service";
import { summarizePastSessions } from "@/lib/services/openPlay/openPlayTypes";
import { Button } from "@/components/ui/button";
import { PastSessionsTable, type PastSession } from "./past-sessions-table";
import { tallySpots } from "@/lib/services/openPlay/openPlayTypes";
import { fetchUpcomingClosures } from "@/lib/services/schedule/venueClosures.service";
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
  /** null for a one-time session added on a specific date */
  schedule_id?: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  price_per_spot?: number;
  status: "open" | "cancelled" | "flagged";
  flag_reason: string | null;
  booked: number;
  /** Set when the date is a closed date (venue_closures): the reason, or "" when none was given */
  closedReason?: string | null;
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
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const [past, setPast] = useState<PastSession[] | null>(null);

  // The last 28 days, loaded when staff open the Past view
  const loadPast = useCallback(async () => {
    const today = new Date();
    const from = new Date(today.getTime() - WINDOW_DAYS * 86400000);
    const { data: sess, error } = await supabase
      .from("open_play_sessions")
      .select("id, schedule_id, session_date, start_time, end_time, capacity, status, flag_reason, price_per_spot")
      .gte("session_date", formatManilaDate(from))
      .lt("session_date", formatManilaDate(today))
      .neq("status", "flagged")
      .order("session_date", { ascending: false })
      .order("start_time", { ascending: false });
    const { data: rows, error: rowsError } = await fetchPastSpotRows((sess ?? []).map((s) => s.id));
    if (error || rowsError) toast.error("Failed to load past sessions.");
    const sums = summarizePastSessions(rows);
    setPast(
      (sess ?? []).map((s) => {
        const sum = sums.get(s.id) ?? { booked: 0, played: 0, collected: 0 };
        return { ...s, ...sum } as PastSession;
      })
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadPast() sets state after its await
    if (view === "past" && past === null) loadPast();
  }, [view, past, loadPast]);

  const load = useCallback(async () => {
    const today = new Date();
    const end = new Date(today.getTime() + WINDOW_DAYS * 86400000);
    const [sched, sess, courtRes, closures] = await Promise.all([
      supabase.from("open_play_schedules").select("*").eq("active", true),
      supabase
        .from("open_play_sessions")
        .select("id, schedule_id, session_date, start_time, end_time, capacity, status, flag_reason, price_per_spot")
        .gte("session_date", formatManilaDate(today))
        .lte("session_date", formatManilaDate(end))
        .order("session_date")
        .order("start_time"),
      fetchCourtsData(),
      fetchUpcomingClosures(),
    ]);
    // Players can no longer see a session on a closed date; staff still need to refund who already booked
    const closedOn = new Map(closures.data.map((c) => [c.closed_on, c.reason ?? ""]));
    setSchedules((sched.data ?? []) as OpenPlaySchedule[]);
    setCourts(courtRes.data);

    const { data: spotRows, error: spotError } = await fetchSpotRows((sess.data ?? []).map((s) => s.id));
    // Without spot rows the counts read 0: say so
    if (sched.error || sess.error || courtRes.error || spotError) toast.error("Failed to load open play. Refresh before changing anything.");
    const { booked } = tallySpots(spotRows);
    const rows = (sess.data ?? []).map((s) => ({ ...s, booked: booked.get(s.id) ?? 0, closedReason: closedOn.get(s.session_date) ?? null })) as OpenPlayAdminSession[];
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
      description: "Everyone who booked is cancelled. Payments are not refunded automatically: they show as Refund Owed on Payments for players who ask. This cannot be undone.",
      confirmLabel: "Cancel session",
      onConfirm: async () => {
        const res = await fetch("/api/admin/open-play/sessions/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return toast.error(body.error ?? "Could not cancel the session.");
        toast.success("Session cancelled. Refund players who ask from the Payments page.");
        load();
      },
    });

  return (
    <>
      <ScheduleTable schedules={schedules} courts={courts} loading={loading} onChanged={load} />
      <div className="flex gap-2" role="group" aria-label="Which sessions">
        <Button variant={view === "upcoming" ? "default" : "outline"} size="sm" aria-pressed={view === "upcoming"} onClick={() => { setView("upcoming"); setSelected(null); }}>
          Upcoming
        </Button>
        <Button variant={view === "past" ? "default" : "outline"} size="sm" aria-pressed={view === "past"} onClick={() => { setView("past"); setSelected(null); }}>
          Past 28 days
        </Button>
      </div>
      {view === "upcoming" ? (
        <SessionsTable sessions={sessions} loading={loading} selectedId={selected?.id} onPlayers={setSelected} onCancel={askCancel} />
      ) : (
        <PastSessionsTable sessions={past ?? []} loading={past === null} onPlayers={setSelected} />
      )}
      {selected && (
        <PlayersPanel key={selected.id} session={selected} onCancel={askCancel} onChanged={() => { load(); setPast(null); }} />
      )}
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </>
  );
}
