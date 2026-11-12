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
import { hourRangeLabel } from "@/lib/services/bookings/quickStarts";
import { formatTime12h } from "@/lib/utils/formatTime";

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

// "8 AM", "12 PM": the same way of writing times as the booking grid. Hours past 24 are after midnight.
const hourLabel = (h: number) => {
  const x = h % 24;
  return `${x % 12 || 12} ${x < 12 ? "AM" : "PM"}`;
};

const LABEL_COL = 88; // px, the court names

/** Hours since midnight of the business day, now, in Manila: 1:30 AM after the business day began is 25.5 */
const nowHours = (today: string, now: Date) => {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  const [h, m] = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  return h + m / 60 + (date > today ? 24 : 0);
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
  // The "now" line moves every minute; null until mounted, as the server can't know the time
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

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
          <div className="relative min-w-[760px] flex flex-col gap-1.5 pt-5">
            {/* Every other hour is labelled; each label sits over the start of its hour */}
            <div className="grid text-[11px] font-semibold text-muted-foreground" style={{ gridTemplateColumns: `${LABEL_COL}px repeat(${data.range.to - data.range.from}, minmax(0, 1fr))` }}>
              <span />
              {Array.from({ length: data.range.to - data.range.from }, (_, i) =>
                i % 2 === 0 ? (
                  <span key={i} className="border-l border-border pl-1 whitespace-nowrap" style={{ gridColumn: `${i + 2} / span 2` }}>
                    {hourLabel(data.range.from + i)}
                  </span>
                ) : null
              )}
            </div>
            {(() => {
              // Who is on court right now, and who is next, read against one red line
              if (!now) return null;
              const at = nowHours(data.today, now);
              if (at < data.range.from || at > data.range.to) return null;
              const share = (at - data.range.from) / (data.range.to - data.range.from);
              const left = `calc(${LABEL_COL}px + (100% - ${LABEL_COL}px) * ${share.toFixed(4)})`;
              return (
                <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left }}>
                  <span className="absolute top-0 -translate-x-1/2 rounded bg-red-600 px-1.5 py-px text-[10px] font-bold text-white whitespace-nowrap">
                    Now {now.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span className="absolute top-4 bottom-0 w-0.5 -translate-x-1/2 bg-red-600/70" />
                </div>
              );
            })()}
            {data.courts.map((court) => {
              const blocks = data.rows.filter((r) => r.court_id === court.id);
              const off = court.status === "maintenance" || court.status === "closed";
              return (
                <div
                  key={court.id}
                  className="grid items-center h-12 rounded-lg bg-muted/40"
                  style={{ gridTemplateColumns: `${LABEL_COL}px repeat(${data.range.to - data.range.from}, minmax(0, 1fr))` }}
                >
                  <span className="px-2 text-sm font-semibold truncate">{court.name}</span>
                  {off && (
                    <span className="h-10 rounded-md flex items-center px-2 text-[11px] font-semibold text-muted-foreground bg-[repeating-linear-gradient(135deg,#EDF0EE_0_6px,#E3E7E5_6px_12px)]" style={{ gridColumn: `2 / -1` }}>
                      {court.status === "maintenance" ? "Maintenance" : "Closed"}
                    </span>
                  )}
                  {!off && blocks.map((b) => {
                    const block = timelineBlock(b, data.today, data.range);
                    if (!block) return null;
                    const who = b.open_play_session_id ? "Open play" : b.customer_name || b.customers?.full_name || b.profiles?.full_name || "Guest";
                    const done = b.status === "completed" || b.status === "no_show";
                    const when = hourRangeLabel(`${formatTime12h(b.start_time)} - ${formatTime12h(b.end_time)}`);
                    return (
                      <span
                        key={b.id}
                        title={`${who} · ${court.name} · ${when}`}
                        className={`h-10 rounded-md flex flex-col justify-center px-2 leading-tight overflow-hidden whitespace-nowrap ${
                          b.open_play_session_id ? "border-[1.5px] border-dashed border-primary bg-primary/10 text-primary"
                            : done ? "bg-muted-foreground/40 text-foreground" : "bg-primary text-primary-foreground"
                        }`}
                        style={{ gridColumn: `${block.from} / ${block.to}` }}
                      >
                        <span className="text-[11px] font-semibold truncate">{who}</span>
                        <span className="text-[10px] opacity-90 truncate">{when}</span>
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
