import { CalendarDays, CalendarX2, ArrowRight } from "lucide-react";

const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

/**
 * The booking grid's place on a day the venue doesn't open: why, and one tap to the next day it does.
 * `reason` is a closed date's note (venue_closures); without one the weekday is simply closed.
 */
export function VenueClosed({
  date,
  closedDate,
  reason,
  nextOpen,
  onPick,
  onPickAnother,
}: {
  date: Date;
  /** A one-off closed date (holiday, event); otherwise the weekday is simply not open */
  closedDate: boolean;
  reason?: string | null;
  /** The next day with bookable hours, if one is coming up */
  nextOpen: Date | null;
  onPick: (d: Date) => void;
  onPickAnother: () => void;
}) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  return (
    <section
      aria-labelledby="venue-closed-title"
      className="relative overflow-hidden rounded-2xl border bg-card px-6 py-12 sm:py-16 flex flex-col items-center text-center gap-4"
    >
      <span className="grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground" aria-hidden>
        <CalendarX2 className="size-8" />
      </span>
      <div className="flex flex-col gap-1.5 max-w-md">
        <h3 id="venue-closed-title" className="text-2xl font-bold">Closed on {dayLabel(date)}</h3>
        <p className="text-muted-foreground">
          {closedDate && reason ? (
            <>The venue is closed on this date for <b className="text-foreground">{reason}</b>.</>
          ) : closedDate ? (
            <>The venue is closed on this date.</>
          ) : (
            <>The venue is closed on this date. It doesn&apos;t open on {weekday}s.</>
          )}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {nextOpen && (
          <button
            type="button"
            onClick={() => onPick(nextOpen)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Book {dayLabel(nextOpen)}
            <ArrowRight className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onPickAnother}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted"
        >
          <CalendarDays className="size-4" aria-hidden />
          Pick another date
        </button>
      </div>
    </section>
  );
}
