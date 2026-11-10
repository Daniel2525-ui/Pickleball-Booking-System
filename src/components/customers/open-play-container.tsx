"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Lock, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { formatTime12h } from "@/lib/utils/formatTime";
import { bookOpenPlay, fetchOpenPlaySessions, type OpenPlaySession } from "@/lib/services/openPlay/openPlayData.service";

const WINDOW_DAYS = 27;

const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00+08:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" });

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

  useEffect(() => {
    const supabase = createClient();
    const today = new Date();
    Promise.all([
      fetchOpenPlaySessions(formatManilaDate(today), formatManilaDate(new Date(today.getTime() + WINDOW_DAYS * 86_400_000))),
      supabase.auth.getUser(),
    ])
      .then(([res, auth]) => {
        // A failed load must not read as "no sessions scheduled"
        if (res.error) setLoadFailed(true);
        setSessions(res.data);
        setSignedIn(Boolean(auth.data.user));
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const maxSpots = active ? Math.min(4 - active.my_spots, active.spots_left) : 0;

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

  return (
    <div className="max-w-3xl mx-auto px-4 space-y-4">
      <div>
        <h1 className="font-display font-black text-3xl uppercase tracking-wide">Open Play</h1>
        <p className="text-sm text-muted-foreground mt-1">Join a scheduled session. Book 1 to 4 spots, no court needed.</p>
      </div>

      {loading ? (
        <LoaderCircle className="size-8 animate-spin text-primary mt-8 mx-auto" aria-label="Loading" />
      ) : loadFailed ? (
        <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm">Couldn&apos;t load open play sessions. Please refresh the page.</p>
      ) : sessions.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">No open play sessions are scheduled in the next four weeks. Check back soon.</p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => {
            const full = s.spots_left <= 0;
            const limit = s.my_spots >= 4;
            const pct = Math.round(((s.capacity - s.spots_left) / s.capacity) * 100);
            return (
              <li key={s.id} className={`rounded-2xl border bg-card p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 ${full ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <p className="font-bold">{dateLabel(s.session_date)} · {formatTime12h(s.start_time)} – {formatTime12h(s.end_time)}</p>
                  <p className="text-sm text-muted-foreground">{s.court_names.join(", ")} · All levels welcome</p>
                  <p className="text-sm mt-1.5">
                    <b>{full ? "Full" : `${s.spots_left} of ${s.capacity}`}</b>{full ? "" : " spots left"}
                    {s.my_spots > 0 && <span className="text-primary font-semibold"> · You have {s.my_spots}</span>}
                  </p>
                  <div role="progressbar" aria-label="Spots taken" aria-valuemin={0} aria-valuemax={s.capacity} aria-valuenow={s.capacity - s.spots_left} className="h-1.5 w-44 rounded bg-muted mt-1.5">
                    <div className={`h-1.5 rounded ${pct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-extrabold">₱{Number(s.price_per_spot).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">/ player</span></p>
                  <Button
                    onClick={() => open(s)}
                    disabled={full || limit}
                    aria-label={full ? `Full: ${dateLabel(s.session_date)}` : `Book a spot on ${dateLabel(s.session_date)}`}
                    className="mt-2 min-h-[44px] font-bold"
                  >
                    {full ? "Full" : limit ? "4 booked" : "Book a spot"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
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
