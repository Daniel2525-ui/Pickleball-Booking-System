"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

const manila = (now: Date) => ({
  date: now.toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  time: now.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }),
});

/** The venue's date and time, ticking. The server renders the date; the time appears once the browser takes over. */
/** `timeOnly` when the date is already the page title */
export default function DashboardClock({ date, timeOnly = false }: { date: string; timeOnly?: boolean }) {
  const [now, setNow] = useState<{ date: string; time: string } | null>(null);

  useEffect(() => {
    const tick = () => setNow(manila(new Date()));
    const first = setTimeout(tick);
    // Every second so the minute flips on time
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Clock className="size-3.5 text-primary shrink-0" />
      {timeOnly ? <span>Venue time</span> : <span>{now?.date ?? date}</span>}
      {now && (
        <>
          <span aria-hidden="true">·</span>
          <time className="font-bold text-foreground tabular-nums">{now.time}</time>
        </>
      )}
    </div>
  );
}
