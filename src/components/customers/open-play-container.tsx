"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, LoaderCircle, Lock, Minus, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatManilaDate, lateNightLabel } from "@/lib/utils/bookingTime";
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";
import { formatTime12h } from "@/lib/utils/formatTime";
import { calculateDuration } from "@/lib/helpers/totalDuration";
import { bookOpenPlay, fetchOpenPlaySessions, type OpenPlaySession } from "@/lib/services/openPlay/openPlayData.service";

const WINDOW_DAYS = 27;

const dayOf = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00+08:00`).toLocaleDateString("en-US", { ...opts, timeZone: "Asia/Manila" });
const dateLabel = (d: string) => dayOf(d, { weekday: "short", month: "short", day: "numeric" });

export const OpenPlayContainer = () => {
  const router = useRouter();
  const [sessions, setSessions] = useState<OpenPlaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [active, setActive] = useState<OpenPlaySession | null>(null);
  const [spots, setSpots] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dayEndsAt, setDayEndsAt] = useState("00:00");
  const [spotLimit, setSpotLimit] = useState(4);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const today = new Date();
    Promise.all([
      fetchOpenPlaySessions(formatManilaDate(today), formatManilaDate(new Date(today.getTime() + WINDOW_DAYS * 86_400_000))),
      supabase.auth.getUser(),
      fetchBookingPolicy(supabase),
    ])
      .then(([res, auth, policy]) => {
        setDayEndsAt(policy.dayEndsAt);
        setSpotLimit(policy.maxOpenPlaySpots);
        // A failed load must not read as "no sessions scheduled"
        if (res.error) setLoadFailed(true);
        setSessions(res.data);
        setSignedIn(Boolean(auth.data.user));
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const maxSpots = active ? Math.min(spotLimit - active.my_spots, active.spots_left) : 0;
  const today = formatManilaDate(new Date());
  // Only days that have sessions get a chip, so every session in the window stays reachable
  const days = [...new Set(sessions.map((s) => s.session_date))];
  const shown = day ? sessions.filter((s) => s.session_date === day) : sessions;

  const open = (s: OpenPlaySession) => {
    if (!signedIn) return router.push("/login");
    setActive(s);
    setSpots(1);
    setError(null);
  };

  const confirm = async () => {
    if (!active) return;
    setSubmitting(true);
    setError(null);
    const { url, error } = await bookOpenPlay(active.id, spots);
    if (url) return void (window.location.href = url);
    setError(error ?? "Could not book your spots.");
    setSubmitting(false);
  };

  const chip = (on: boolean) =>
    `shrink-0 min-w-[72px] min-h-[68px] rounded-[14px] border-[1.5px] px-3 py-2 text-center transition-colors ${on ? "bg-primary border-primary text-primary-foreground" : "bg-card hover:border-primary/50"}`;

  const howItWorks = (
    <section className="rounded-2xl border bg-card p-5 space-y-3.5">
      <h2 className="font-display text-lg font-bold">How it works</h2>
      <ol className="space-y-3 text-sm">
        {[
          `Pick a session and how many spots, up to ${spotLimit}.`,
          "Pay with QR Ph. Your spots are held while you pay.",
          "Just turn up. No check-in, games rotate on the courts listed.",
        ].map((text, i) => (
          <li key={text} className="flex gap-3">
            <span className="size-[26px] shrink-0 rounded-lg bg-primary/10 text-primary grid place-items-center text-[13px] font-bold">{i + 1}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 space-y-7">
      <div className="space-y-3.5">
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">Open play</h1>
        <p className="max-w-2xl text-muted-foreground">
          Drop in and play with others. Pay per player, rotate in and out between games, and meet new partners. No need to book a whole court.
        </p>
        <ul aria-label="About open play" className="flex flex-wrap gap-2">
          {["Pay per player", "Rotate in and out", "All levels welcome", `Up to ${spotLimit} ${spotLimit === 1 ? "spot" : "spots"} per booking`].map((fact) => (
            <li key={fact} className="inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-[13px] font-semibold">
              <Check className="size-4 text-primary" aria-hidden />
              {fact}
            </li>
          ))}
        </ul>
      </div>

      {loading ? (
        <LoaderCircle className="size-8 animate-spin text-primary mt-8 mx-auto" aria-label="Loading" />
      ) : loadFailed ? (
        <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm">Couldn&apos;t load open play sessions. Please refresh the page.</p>
      ) : sessions.length === 0 ? (
        <div className="flex flex-wrap gap-7">
          <section className="flex-[999_1_560px] min-w-0 rounded-[20px] border bg-card px-8 py-12 flex flex-col items-center text-center gap-3.5">
            <span className="size-16 rounded-[18px] bg-primary/10 grid place-items-center">
              <CalendarDays className="size-8 text-primary" aria-hidden />
            </span>
            <h2 className="font-display text-2xl font-bold">No sessions in the next four weeks</h2>
            <p className="max-w-md text-[15px] text-muted-foreground">
              New open play sessions show up here as soon as they are scheduled. In the meantime, you can book a court for your own group.
            </p>
            <Link href="/book" className={cn(buttonVariants(), "mt-1.5 min-h-11 px-4 font-bold")}>Book a court</Link>
          </section>
          <div className="flex-[1_1_300px]">{howItWorks}</div>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Pick a day" className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            <button type="button" aria-pressed={day === null} onClick={() => setDay(null)} className={chip(day === null)}>
              <span className="block text-xs font-semibold opacity-85">All</span>
              <span className="block font-display text-xl font-bold">{sessions.length}</span>
              <span className="block text-[11px] font-semibold">{sessions.length === 1 ? "session" : "sessions"}</span>
            </button>
            {days.map((d) => {
              const count = sessions.filter((s) => s.session_date === d).length;
              return (
                <button key={d} type="button" aria-pressed={day === d} aria-label={`${dateLabel(d)}, ${count} ${count === 1 ? "session" : "sessions"}`} onClick={() => setDay(d)} className={chip(day === d)}>
                  <span className="block text-xs font-semibold opacity-85">{d === today ? "Today" : dayOf(d, { weekday: "short" })}</span>
                  <span className="block font-display text-xl font-bold">{dayOf(d, { day: "numeric" })}</span>
                  <span className="block text-[11px] font-semibold">{dayOf(d, { month: "short" })}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-start gap-7">
            <div className="flex-[999_1_560px] min-w-0 space-y-7">
              {[...new Set(shown.map((s) => s.session_date))].map((d) => (
                <section key={d} className="space-y-3">
                  <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">
                    {d === today ? "Today · " : ""}{dayOf(d, { weekday: "long", month: "short", day: "numeric" })}
                  </h2>
                  <ul className="space-y-3">
                    {shown.filter((s) => s.session_date === d).map((s) => {
                      const full = s.spots_left <= 0;
                      const limit = s.my_spots >= spotLimit;
                      const taken = s.capacity - s.spots_left;
                      const fast = !full && taken / s.capacity >= 0.8;
                      const late = lateNightLabel(s.session_date, s.start_time, dayEndsAt);
                      return (
                        <li key={s.id} className={`rounded-2xl border bg-card px-5 py-5 sm:px-6 flex flex-wrap items-center gap-x-7 gap-y-4 ${s.my_spots > 0 ? "border-amber-300" : ""} ${full ? "opacity-60" : ""}`}>
                          <div className="min-w-[150px] space-y-1">
                            <p className="font-display text-2xl font-bold tracking-tight">{formatTime12h(s.start_time)} – {formatTime12h(s.end_time)}</p>
                            {late && <p className="text-xs font-semibold text-primary">{late}</p>}
                            <p className="text-sm text-muted-foreground">{calculateDuration(s.start_time, s.end_time)} · {s.court_names.join(", ")}</p>
                          </div>
                          <div className="flex-[1_1_220px] min-w-0 space-y-2">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                              {full ? "Full" : `${s.spots_left} of ${s.capacity} spots left`}
                              {s.my_spots > 0 ? (
                                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">You have {s.my_spots}</span>
                              ) : fast ? (
                                <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-800">Filling fast</span>
                              ) : null}
                            </p>
                            {/* One dot per spot; yours are amber */}
                            <div role="img" aria-label={`${taken} of ${s.capacity} spots taken`} className="flex flex-wrap gap-1 max-w-[260px]">
                              {Array.from({ length: s.capacity }, (_, i) => (
                                <span
                                  key={i}
                                  className={`size-3.5 rounded-full border-[1.5px] ${i >= taken ? "bg-card border-border" : i >= taken - s.my_spots ? "bg-amber-500 border-amber-500" : "bg-primary border-primary"}`}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="ml-auto flex flex-col items-end gap-2">
                            <p className="font-display text-[22px] font-bold">
                              ₱{Number(s.price_per_spot).toLocaleString()} <span className="font-sans text-xs font-medium text-muted-foreground">/ player</span>
                            </p>
                            <Button
                              onClick={() => open(s)}
                              disabled={full || limit}
                              variant={s.my_spots > 0 ? "outline" : "default"}
                              aria-label={full ? `Full: ${dateLabel(s.session_date)}` : `Book a spot on ${dateLabel(s.session_date)} at ${formatTime12h(s.start_time)}`}
                              className={`min-h-11 px-5 font-bold ${s.my_spots > 0 ? "border-primary text-primary" : ""}`}
                            >
                              {full ? "Full" : limit ? `${s.my_spots} booked` : s.my_spots > 0 ? "Add a spot" : "Join"}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            <aside className="flex-[1_1_300px] space-y-4">
              {howItWorks}
              <section className="rounded-2xl border bg-card p-5 space-y-2.5">
                <h2 className="font-display text-lg font-bold">Playing with your own group?</h2>
                <p className="text-sm text-muted-foreground">Book a whole court by the hour instead.</p>
                <Link href="/book" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 px-4 font-bold border-primary text-primary")}>Book a court</Link>
              </section>
            </aside>
          </div>
        </>
      )}

      <Dialog open={active !== null} onOpenChange={(o) => !o && !submitting && setActive(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book open play</DialogTitle>
            <DialogDescription>
              {active && `${dateLabel(active.session_date)} · ${formatTime12h(active.start_time)} – ${formatTime12h(active.end_time)}`}
            </DialogDescription>
          </DialogHeader>
          {active && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span id="spots-label" className="text-sm font-semibold">Spots</span>
                <div className="flex items-center gap-3" role="group" aria-labelledby="spots-label">
                  <Button type="button" variant="outline" size="icon" className="size-11" aria-label="One fewer spot" disabled={spots <= 1} onClick={() => setSpots(spots - 1)}>
                    <Minus className="size-4" />
                  </Button>
                  <output aria-live="polite" className="w-6 text-center text-lg font-bold">{spots}</output>
                  <Button type="button" variant="outline" size="icon" className="size-11" aria-label="One more spot" disabled={spots >= maxSpots} onClick={() => setSpots(spots + 1)}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted p-4">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-lg font-extrabold">₱{(spots * Number(active.price_per_spot)).toLocaleString()}</span>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setActive(null)} disabled={submitting} className="w-full sm:w-auto h-11 font-semibold">Cancel</Button>
            <Button onClick={confirm} disabled={submitting || maxSpots < 1} className="w-full sm:w-auto h-11 font-bold gap-2">
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {submitting ? "Redirecting..." : "Continue to Checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
