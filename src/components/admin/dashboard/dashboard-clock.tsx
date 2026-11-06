"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

const manila = (now: Date) => ({
  date: now.toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  time: now.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }),
});

/** The venue's date and time, ticking. The server renders the date; the time appears once the browser takes over. */
export default function DashboardClock({ date }: { date: string }) {
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
    <div className="flex items-center gap-2 self-start sm:self-auto text-xs font-medium text-muted-foreground bg-muted/40 border border-border px-3 py-1.5 rounded-lg shadow-2xs">
      <Clock className="size-3.5 text-primary shrink-0" />
      <span>{now?.date ?? date}</span>
      {now && (
        <>
          <span aria-hidden="true">·</span>
          <time className="font-bold text-foreground tabular-nums">{now.time}</time>
        </>
      )}
    </div>
  );
}
