"use client";

import { useEffect, useState } from "react";
import { openNowLabel, type HoursInput } from "@/lib/services/schedule/hoursRules";

/** The clock, re-read every minute; null until mounted, as the server can't know the visitor's time */
function useNow() {
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
  return now;
}

/** The same status as plain text, for the "Find us" details */
export function OpenNowText({ hours }: { hours: HoursInput[] }) {
  const now = useNow();
  return <span>{now ? openNowLabel(hours, now).text : "See opening hours above"}</span>;
}

/** Hero badge: a pulsing dot and a slow shine while the venue is open, still and grey when it isn't. */
export function OpenNowBadge({ hours }: { hours: HoursInput[] }) {
  const now = useNow();
  if (!now) return <span className="h-8" aria-hidden />;
  const { open, text } = openNowLabel(hours, now);
  return (
    <span className="inline-flex items-center gap-2 self-start rounded-full border border-primary/35 bg-card px-3 py-1.5 text-sm font-semibold text-primary shadow-xs">
      <span className={`size-2 rounded-full ${open ? "live-dot bg-primary" : "bg-muted-foreground"}`} aria-hidden />
      <span className={open ? "shine-text" : "text-muted-foreground"}>{text}</span>
    </span>
  );
}
