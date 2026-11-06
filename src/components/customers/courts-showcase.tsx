"use client";

import { useEffect, useState } from "react";
import { fetchBookingsForDate, type BookingSlot } from "@/lib/services/bookings/fetchBookingsForDate.service";
import { courtShowcaseStatus, type ShowcaseState } from "@/lib/services/courts/courtShowcase";
import { getBookingWeekday } from "@/lib/services/bookings/validateBookingSlot.service";
import { formatManilaDate } from "@/lib/utils/bookingTime";

export interface ShowcaseCourt { id: string; name: string; status: string | null; maintenance_note: string | null }
interface Hours { day_of_week: string; is_open: boolean; open_time: string | null; close_time: string | null }

const REFRESH_MS = 60_000;
const PILL: Record<ShowcaseState, string> = {
  busy: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  free: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  off: "bg-muted text-muted-foreground",
};

/** A drawn top-down pickleball court: the placeholder until a venue has real court photos. */
function CourtArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 440 240" aria-hidden="true" className={className} preserveAspectRatio="xMidYMid slice">
      <rect width="440" height="240" className="fill-muted" />
      <g transform="translate(20 20)">
        <rect width="400" height="200" rx="4" fill="oklch(0.42 0.09 240)" />
        {/* The kitchen (non-volley zone) on both sides of the net */}
        <rect x="128" width="144" height="200" className="fill-primary/15" />
        <g fill="none" stroke="oklch(0.98 0.01 250 / .9)" strokeWidth="3">
          <rect x="4" y="4" width="392" height="192" />
          <line x1="128" y1="4" x2="128" y2="196" />
          <line x1="272" y1="4" x2="272" y2="196" />
          <line x1="4" y1="100" x2="128" y2="100" />
          <line x1="272" y1="100" x2="396" y2="100" />
        </g>
        <line x1="200" y1="-6" x2="200" y2="206" stroke="oklch(0.98 0.01 250)" strokeWidth="5" />
        <circle cx="238" cy="70" r="7" className="fill-primary" />
      </g>
    </svg>
  );
}

/** "Our courts" on the landing page: one featured court, every court listed with its status right now. */
export function CourtsShowcase({ courts, hours }: { courts: ShowcaseCourt[]; hours: Hours[] }) {
  const [selectedId, setSelectedId] = useState(courts[0]?.id);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  // Set after mount: statuses depend on the visitor's clock, which the server can't know
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const at = new Date();
      const { data } = await fetchBookingsForDate(at);
      if (!active) return;
      setSlots(data);
      setNow(at);
    };
    const first = setTimeout(load);
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (courts.length === 0) return null;
  const today = now ? formatManilaDate(now) : null;
  const todayHours = today ? hours.find((h) => h.day_of_week === getBookingWeekday(today)) ?? null : null;
  const statusOf = (court: ShowcaseCourt) => (now && today ? courtShowcaseStatus(court, slots, todayHours, today, now) : null);
  const featured = courts.find((c) => c.id === selectedId) ?? courts[0];
  const featuredStatus = statusOf(featured);

  const pill = (status: ReturnType<typeof statusOf>) =>
    status && (
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${PILL[status.state]}`}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {status.label}
      </span>
    );

  return (
    <section aria-label="Our courts" className="w-full border-t py-12 md:py-16">
      <div className="container mx-auto px-4 max-w-6xl">
        <h2 className="text-5xl sm:text-6xl leading-[0.9] text-foreground">Our courts</h2>
        <p className="mt-2 max-w-[60ch] text-sm sm:text-base text-muted-foreground">
          Pick a court to see it up close and whether it&apos;s free right now.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div role="group" aria-label="Featured court" aria-live="polite" className="relative overflow-hidden rounded-2xl border bg-card">
            <CourtArt className="block aspect-[16/10] w-full" />
            {/* Over the picture from sm up; below it on phones, where it would cover most of the court */}
            <div className="flex flex-wrap items-end justify-between gap-3 p-4 sm:absolute sm:inset-x-0 sm:bottom-0 sm:bg-gradient-to-t sm:from-background/95 sm:to-transparent sm:p-5">
              <div className="min-w-0">
                <h3 className="font-display text-4xl sm:text-5xl font-black leading-[0.9] text-foreground">{featured.name}</h3>
                {featuredStatus && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {pill(featuredStatus)}
                    <span>{featuredStatus.detail}</span>
                  </p>
                )}
              </div>
              {featuredStatus?.state !== "off" && (
                <a
                  href="#booking"
                  className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-md hover:bg-primary/90"
                >
                  Book {featured.name}
                </a>
              )}
            </div>
          </div>

          <ul className="flex flex-col gap-2.5">
            {courts.map((court) => {
              const status = statusOf(court);
              return (
                <li key={court.id}>
                  <button
                    type="button"
                    aria-pressed={court.id === featured.id}
                    onClick={() => setSelectedId(court.id)}
                    className="grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition-colors hover:bg-muted/40 aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary"
                  >
                    <CourtArt className="block w-[72px] rounded-md" />
                    <span className="min-w-0">
                      <span className="block truncate font-display text-xl font-black text-foreground">{court.name}</span>
                      {status && <span className="block truncate text-xs text-muted-foreground">{status.detail}</span>}
                    </span>
                    {pill(status)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
