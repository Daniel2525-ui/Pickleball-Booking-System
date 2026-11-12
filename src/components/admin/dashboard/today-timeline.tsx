"use client";

import { useEffect, useState } from "react";
import { todaysSchedule } from "@/lib/services/dashboard/schedToday.service";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service";
import { fetchBusinessToday } from "@/lib/services/settings/bookingPolicy";
import { getBookingWeekday } from "@/lib/services/bookings/validateBookingSlot.service";
import { supabase } from "@/lib/supabase";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { timelineRange, timelineBlock } from "@/lib/services/dashboard/timeline";

type Row = {
  id: string;
  court_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  open_play_session_id?: string | null;
  customer_name?: string | null;
  profiles?: { full_name: string } | null;
  customers?: { full_name: string } | null;
};
type Court = { id: string; name: string; status: string };

const hourLabel = (h: number) => {
  const x = h % 24;
  return x === 0 ? "12a" : x === 12 ? "12p" : x < 12 ? `${x}a` : `${x - 12}p`;
};

async function loadTimeline() {
  const [rows, courts, hours, today] = await Promise.all([todaysSchedule(), fetchCourtsData(), fetchOperatingHours(), fetchBusinessToday(supabase)]);
  const range = timelineRange(hours.data ?? [], getBookingWeekday(today), rows, today);
  return { rows: rows as unknown as Row[], courts: (courts.data ?? []) as Court[], range, today };
}

/** Every court across today's hours: who has it when. After-midnight bookings sit at the end of the same day. */
export default function TodayTimeline() {
  const [data, setData] = useState<{ rows: Row[]; courts: Court[]; range: { from: number; to: number }; today: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let ignore = false;
    loadTimeline().then((d) => !ignore && setData(d)).catch(() => !ignore && setFailed(true));
    return () => {
      ignore = true;
    };
  }, []);
  useLiveRefresh(() => loadTimeline().then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true)));

  return (
    <section aria-labelledby="timeline-title" className="rounded-2xl border bg-card p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="timeline-title" className="text-lg font-bold">Today across every court</h2>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-primary" aria-hidden />Booked</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border-[1.5px] border-dashed border-primary bg-primary/10" aria-hidden />Open play</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-muted-foreground/40" aria-hidden />Finished</span>
        </p>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">Couldn&apos;t load today&apos;s bookings. They refresh automatically.</p>
      ) : !data ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[680px] flex flex-col gap-1.5">
            <div className="grid text-[11px] font-semibold text-muted-foreground" style={{ gridTemplateColumns: `88px repeat(${data.range.to - data.range.from}, minmax(0, 1fr))` }}>
              <span />
              {Array.from({ length: data.range.to - data.range.from }, (_, i) => (
                <span key={i}>{(i % 2 === 0) ? hourLabel(data.range.from + i) : ""}</span>
              ))}
            </div>
            {data.courts.map((court) => {
              const blocks = data.rows.filter((r) => r.court_id === court.id);
              const off = court.status === "maintenance" || court.status === "closed";
              return (
                <div
                  key={court.id}
                  className="grid items-center h-9 rounded-lg bg-muted/40"
                  style={{ gridTemplateColumns: `88px repeat(${data.range.to - data.range.from}, minmax(0, 1fr))` }}
                >
                  <span className="px-2 text-sm font-semibold truncate">{court.name}</span>
                  {off && (
                    <span className="h-7 rounded-md flex items-center px-2 text-[11px] font-semibold text-muted-foreground bg-[repeating-linear-gradient(135deg,#EDF0EE_0_6px,#E3E7E5_6px_12px)]" style={{ gridColumn: `2 / -1` }}>
                      {court.status === "maintenance" ? "Maintenance" : "Closed"}
                    </span>
                  )}
                  {!off && blocks.map((b) => {
                    const block = timelineBlock(b, data.today, data.range);
                    if (!block) return null;
                    const who = b.open_play_session_id ? "Open play" : b.customer_name || b.customers?.full_name || b.profiles?.full_name || "Guest";
                    const done = b.status === "completed" || b.status === "no_show";
                    return (
                      <span
                        key={b.id}
                        title={`${who} · ${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}`}
                        className={`h-7 rounded-md flex items-center px-2 text-[11px] font-semibold overflow-hidden whitespace-nowrap ${
                          b.open_play_session_id ? "border-[1.5px] border-dashed border-primary bg-primary/10 text-primary"
                            : done ? "bg-muted-foreground/40 text-foreground" : "bg-primary text-primary-foreground"
                        }`}
                        style={{ gridColumn: `${block.from} / ${block.to}` }}
                      >
                        {who}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
