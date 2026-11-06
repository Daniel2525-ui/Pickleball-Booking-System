"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchLiveCourts } from "@/lib/services/dashboard/courtStatus.service";
import type { LiveCourtTile, LiveState } from "@/lib/services/dashboard/liveCourts";
import { formatTime12h } from "@/lib/utils/formatTime";

const TAGS: Record<LiveState, { label: string; style: string }> = {
  in_play: { label: "In play", style: "bg-primary/15 text-primary" },
  free: { label: "Free", style: "bg-muted text-muted-foreground" },
  open_play: { label: "Open play", style: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  maintenance: { label: "Maintenance", style: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  closed: { label: "Closed", style: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400" },
};

const REFRESH_MS = 60_000;

const timeLeft = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""} left` : `${m} min left`);
const clock = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

/** Who is on each court right now, how long they have, whether they paid, and who is next. Refreshes every minute. */
export default function CourtStatus({ className }: { className?: string }) {
  const [tiles, setTiles] = useState<LiveCourtTile[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const now = new Date();
      const { data } = await fetchLiveCourts(now);
      if (!active) return;
      // A failed refresh keeps the last tiles (their time stays visible); only a first load with nothing to show says so
      setFailed(!data);
      if (!data) return;
      setTiles(data);
      setUpdatedAt(now);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Card role="region" aria-label="Live Court Occupancy" className={`border border-border shadow-2xs ${className || ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-foreground">Live Court Occupancy</CardTitle>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            {updatedAt ? `Live · ${clock(updatedAt)}` : "Live"}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        {tiles === null && failed ? (
          <p role="alert" className="py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load the courts. Trying again every minute.</p>
        ) : tiles === null ? (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          </div>
        ) : tiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Layers className="size-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">No courts found</p>
            <p className="text-xs text-muted-foreground">Add courts in the Courts &amp; Rates section.</p>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
            {tiles.map((t) => <CourtTile key={t.name} tile={t} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CourtTile({ tile: t }: { tile: LiveCourtTile }) {
  const tag = TAGS[t.state];
  const busy = t.state === "in_play" || t.state === "open_play";
  return (
    <div
      role="group"
      aria-label={t.name}
      className={`flex flex-col gap-1.5 rounded-xl border bg-card p-3 shadow-2xs ${t.state === "in_play" ? "border-primary/40" : "border-border/80"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-bold text-foreground">{t.name}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${tag.style}`}>{tag.label}</span>
      </div>

      {busy && t.slot ? (
        <>
          <p className="truncate text-sm font-semibold text-foreground">{t.who}</p>
          <p className="text-xs text-muted-foreground">
            {formatTime12h(t.slot.start)} – {formatTime12h(t.slot.end)}
            {t.spots && ` · ${t.spots.booked} of ${t.spots.capacity} spots`}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className={`h-full rounded-full ${t.state === "open_play" ? "bg-sky-500" : "bg-primary"}`} style={{ width: `${Math.round((t.progress ?? 0) * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{timeLeft(t.minutesLeft ?? 0)}</span>
            {t.payment && (
              <span className={t.payment.paid ? "" : "font-semibold text-amber-700 dark:text-amber-400"}>{t.payment.label}</span>
            )}
            {t.state === "open_play" && (
              <Link href="/admin/open-play" className="font-semibold text-primary hover:underline underline-offset-4">View players</Link>
            )}
          </div>
        </>
      ) : t.state === "free" ? (
        <>
          <p className="text-sm font-semibold text-muted-foreground">Nobody right now</p>
          <p className="text-xs text-muted-foreground">{t.freeUntil ? `Free until ${formatTime12h(t.freeUntil)}` : "No more bookings today"}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t.note || (t.state === "maintenance" ? "Under maintenance" : "Not in use")}</p>
      )}

      {t.next && (
        <p className="mt-1 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
          Next: <span className="font-semibold text-foreground">{t.next.name}</span> at {formatTime12h(t.next.start)}
        </p>
      )}
    </div>
  );
}
