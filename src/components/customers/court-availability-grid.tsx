"use client";

import { Fragment, useState } from "react";
import { Check, Clock, LoaderCircle, ChevronDown, Moon } from "lucide-react";
import { Slot } from "./types";
import { SlotStatus } from "@/lib/services/bookings/checkSlotAvailability.service";
import { hourRangeLabel } from "@/lib/services/bookings/quickStarts";

interface CourtAvailabilityGridProps {
  selectedDate: Date;
  courts: string[];
  timeSlots: string[];
  onSlotClick: (court: string, time: string) => void;
  getSlotStatus: (date: Date, court: string, time: string) => SlotStatus;
  selectedSlots?: Slot[];
  isFetching?: boolean;
  /** One-hour price shown in open cells */
  priceOf?: (time: string) => number;
  /** The hour is charged at a peak rate */
  peakOf?: (time: string) => boolean;
  /** Section a slot belongs to ("Friday late night", "Saturday"); shown only when a date has more than one */
  headingOf?: (time: string) => string;
}

// Shared looks for each state (desktop cell and phone row)
const LOOK = {
  available: "bg-card border-[1.5px] border-primary/35 text-primary hover:bg-primary/10 hover:border-primary",
  // Filled solid so a pick stands out from the outlined free cells; each hour keeps its own price
  selected: "bg-primary border-2 border-primary text-primary-foreground shadow-md ring-2 ring-primary/30 ring-offset-1 ring-offset-card hover:bg-primary/90",
  user_pending: "bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200",
  pending: "bg-amber-50 text-amber-900 border border-amber-200",
  booked: "bg-[repeating-linear-gradient(135deg,#EDF0EE_0_6px,#E3E7E5_6px_12px)] text-muted-foreground",
  open_play: "bg-primary/5 border-[1.5px] border-dashed border-primary text-primary",
  off: "bg-muted text-muted-foreground",
};
const LABEL: Record<SlotStatus, string> = {
  available: "",
  user_pending: "Resume",
  pending: "Being paid",
  booked: "Booked",
  open_play: "Open play",
  maintenance: "Maintenance",
  closed: "Closed",
  passed: "Passed",
};
const lookOf = (status: SlotStatus) =>
  status === "available" ? LOOK.available
    : status === "user_pending" ? LOOK.user_pending
      : status === "pending" ? LOOK.pending
        : status === "booked" ? LOOK.booked
          : status === "open_play" ? LOOK.open_play
            : LOOK.off;

export const CourtAvailabilityGrid = ({
  selectedDate,
  courts,
  timeSlots,
  onSlotClick,
  getSlotStatus,
  selectedSlots = [],
  isFetching,
  priceOf,
  peakOf,
  headingOf,
}: CourtAvailabilityGridProps) => {
  const colCount = courts.length;
  const [showPassed, setShowPassed] = useState(false);
  const [phoneCourt, setPhoneCourt] = useState(0);
  const activeCourt = courts[Math.min(phoneCourt, colCount - 1)] ?? courts[0];
  const showHeadings = !!headingOf && new Set(timeSlots.map(headingOf)).size > 1;
  // Rows already over on every court (earlier today) are collapsed so open slots show first
  const passedCount = timeSlots.filter((time) => courts.length > 0 && courts.every((court) => getSlotStatus(selectedDate, court, time) === "passed")).length;
  const visibleSlots = showPassed ? timeSlots : timeSlots.slice(passedCount);
  const headingBefore = (i: number) => showHeadings && headingOf!(visibleSlots[i]) !== (i > 0 ? headingOf!(visibleSlots[i - 1]) : null);

  // The basket line covering this cell. By slot position, not clock time: a line can run past midnight (11 PM - 1 AM).
  const spanOf = (l: Slot) => {
    const s = timeSlots.indexOf(l.startSlot || l.time);
    return [s, s + (l.duration || 1)] as const;
  };
  const lineAt = (court: string, time: string) => {
    const i = timeSlots.indexOf(time);
    return selectedSlots.find((l) => {
      if (l.court !== court) return false;
      const [s, e] = spanOf(l);
      return i >= s && i < e;
    });
  };

  const passedToggle = passedCount > 0 && (
    <button
      type="button"
      onClick={() => setShowPassed((v) => !v)}
      className="w-full py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center gap-1.5 transition-colors"
      aria-expanded={showPassed}
    >
      <ChevronDown className={`size-3.5 transition-transform ${showPassed ? "rotate-180" : ""}`} />
      {showPassed ? "Hide" : "Show"} {passedCount} earlier time {passedCount === 1 ? "slot" : "slots"}
    </button>
  );
  const heading = (time: string) => (
    <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-y border-primary/25 text-xs font-semibold text-primary">
      <Moon className="size-3.5" aria-hidden />
      {headingOf!(time)}
    </div>
  );

  return (
    <div className="bg-card border rounded-2xl shadow-xs overflow-hidden flex-1 relative" aria-busy={isFetching}>
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Clock className="size-4.5 text-primary" aria-hidden />
          {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </h2>
        <span className="text-xs text-muted-foreground">Prices per court, per hour</span>
      </div>

      {isFetching && (
        <div className="absolute inset-x-0 bottom-0 top-[52px] bg-background/60 backdrop-blur-[2px] z-30 flex items-center justify-center animate-in fade-in duration-200">
          <div className="flex items-center gap-2 bg-card border shadow-md px-4 py-2 rounded-full text-xs font-semibold">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            <span>Updating availability...</span>
          </div>
        </div>
      )}

      {/* Phones: one court at a time, hours as full-width rows, so nothing scrolls sideways */}
      <div className="md:hidden">
        <div role="tablist" aria-label="Courts" className="flex gap-2 overflow-x-auto px-4 py-3 border-b">
          {courts.map((court, i) => {
            const free = visibleSlots.filter((t) => getSlotStatus(selectedDate, court, t) === "available").length;
            const on = court === activeCourt;
            return (
              <button
                key={court}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPhoneCourt(i)}
                className={`shrink-0 min-h-11 rounded-xl px-3.5 py-1.5 text-left text-sm font-semibold border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card"}`}
              >
                {court}
                <span className={`block text-[11px] ${on ? "opacity-90" : "text-primary"}`}>{free} {free === 1 ? "hr" : "hrs"} free</span>
              </button>
            );
          })}
        </div>
        {passedToggle}
        <ul className="flex flex-col gap-2 p-3">
          {visibleSlots.map((time, i) => {
            const status = getSlotStatus(selectedDate, activeCourt, time);
            const line = lineAt(activeCourt, time);
            const clickable = status === "available" || status === "user_pending" || !!line;
            return (
              <Fragment key={time}>
                {headingBefore(i) && <li className="-mx-3">{heading(time)}</li>}
                <li>
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => onSlotClick(activeCourt, time)}
                      aria-label={line ? `Selected ${activeCourt} at ${time}. Tap to remove.` : status === "user_pending" ? `Resume your pending booking for ${activeCourt} at ${time}` : `Select ${activeCourt} at ${time}`}
                      aria-pressed={!!line}
                      className={`w-full min-h-14 rounded-xl px-4 flex items-center justify-between gap-3 text-[15px] font-semibold transition-colors ${line ? LOOK.selected : lookOf(status)}`}
                    >
                      <span>{time}</span>
                      <span className="text-sm inline-flex items-center gap-1.5">
                        {line && <Check className="size-4" aria-hidden />}
                        {status === "user_pending" && !line ? "Resume" : `₱${priceOf?.(time).toLocaleString() ?? ""}${peakOf?.(time) ? " · peak" : ""}`}
                      </span>
                    </button>
                  ) : (
                    <div className={`w-full min-h-14 rounded-xl px-4 flex items-center justify-between gap-3 text-[15px] font-semibold ${lookOf(status)}`}>
                      <span>{time}</span>
                      <span className="text-sm">{LABEL[status]}</span>
                    </div>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>

      {/* Tablets and up: courts across, hours down */}
      <div className="hidden md:block overflow-x-auto pb-1">
        <div className="min-w-[var(--grid-min)]" style={{ "--grid-min": `${112 + colCount * 104}px` } as React.CSSProperties}>
          <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: `112px repeat(${colCount}, minmax(0, 1fr))` }}>
            <div className="px-3 py-3 text-xs font-semibold text-muted-foreground sticky left-0 z-20 bg-muted/30">Time</div>
            {courts.map((court) => (
              <div key={court} className="px-2 py-3 text-center text-sm font-bold border-l">{court}</div>
            ))}
          </div>

          {passedToggle}
          {visibleSlots.map((time, timeIdx) => (
            <Fragment key={time}>
              {headingBefore(timeIdx) && heading(time)}
              <div className="grid border-t border-border/60" style={{ gridTemplateColumns: `112px repeat(${colCount}, minmax(0, 1fr))` }}>
                <div className="px-3 flex flex-col justify-center min-h-14 sticky left-0 z-10 bg-card">
                  <span className="text-sm font-bold whitespace-nowrap">{hourRangeLabel(time)}</span>
                  {peakOf?.(time) && <span className="text-[10px] font-bold text-amber-800">PEAK</span>}
                </div>
                {courts.map((court) => {
                  const status = getSlotStatus(selectedDate, court, time);
                  const line = lineAt(court, time);
                  if (line) {
                    return (
                      <div key={court} className="border-l border-border/60 p-1">
                        <button
                          type="button"
                          onClick={() => onSlotClick(court, time)}
                          aria-label={`Selected ${court} at ${time}. Click to deselect.`}
                          aria-pressed
                          className={`w-full h-full min-h-12 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-ring ${LOOK.selected}`}
                        >
                          <Check className="size-4" aria-hidden />
                          {priceOf ? `₱${priceOf(time).toLocaleString()}` : "Selected"}
                        </button>
                      </div>
                    );
                  }
                  const clickable = status === "available" || status === "user_pending";
                  return (
                    <div key={court} className="border-l border-border/60 p-1">
                      {clickable ? (
                        <button
                          type="button"
                          onClick={() => onSlotClick(court, time)}
                          aria-label={status === "available" ? `Select ${court} at ${time}` : `Resume your pending booking for ${court} at ${time}`}
                          title={status === "user_pending" ? "Your pending reservation. Click to resume payment or cancel." : undefined}
                          className={`w-full h-full min-h-12 rounded-lg text-sm font-semibold flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${lookOf(status)}`}
                        >
                          {status === "available" ? (priceOf ? `₱${priceOf(time).toLocaleString()}` : "Available") : LABEL.user_pending}
                        </button>
                      ) : (
                        <div
                          aria-label={`${court} at ${time} is ${status === "open_play" ? "open play" : status === "pending" ? "being paid for" : status}`}
                          className={`w-full h-full min-h-12 rounded-lg text-xs font-semibold flex items-center justify-center cursor-not-allowed ${lookOf(status)}`}
                        >
                          {LABEL[status]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

/** The colour key above the grid */
export function GridLegend() {
  const item = (swatch: string, label: string) => (
    <span className="inline-flex items-center gap-2">
      <span className={`size-4 rounded ${swatch}`} aria-hidden />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {item("bg-card border-[1.5px] border-primary/35", "Available")}
      {item("bg-primary border-2 border-primary", "Selected")}
      {/* Taken cells say why (Booked, Open play...), so one grey key covers them all */}
      {item("bg-muted", "Unavailable")}
    </div>
  );
}
