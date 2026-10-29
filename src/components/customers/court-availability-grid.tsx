"use client";

import { useState } from "react";
import { Clock, Check, LoaderCircle, ChevronDown } from "lucide-react";
import { Slot } from "./types";
import { SlotStatus, to24h } from "@/lib/services/bookings/checkSlotAvailability.service";

interface CourtAvailabilityGridProps {
  selectedDate: Date;
  courts: string[];
  timeSlots: string[];
  onSlotClick: (court: string, time: string) => void;
  getSlotStatus: (date: Date, court: string, time: string) => SlotStatus;
  selectedSlot?: Slot | null;
  isFetching?: boolean;
}

export const CourtAvailabilityGrid = ({
  selectedDate,
  courts,
  timeSlots,
  onSlotClick,
  getSlotStatus,
  selectedSlot,
  isFetching,
}: CourtAvailabilityGridProps) => {
  const colCount = courts.length;
  const [showPassed, setShowPassed] = useState(false);
  // Rows already over on every court (earlier today) are collapsed so open slots show first
  const passedCount = timeSlots.filter((time) => courts.length > 0 && courts.every((court) => getSlotStatus(selectedDate, court, time) === "passed")).length;
  const visibleSlots = showPassed ? timeSlots : timeSlots.slice(passedCount);

  return (
    <div
      className="bg-card border rounded-2xl shadow-sm overflow-hidden flex-1 relative"
      aria-busy={isFetching}
    >
      {/* Header with Title and Legend */}
      <div className="p-4 border-b bg-muted/30 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
          <Clock className="size-4.5 sm:size-5 text-primary" />
          Available Times
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" /> Pending / Resume
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/40" /> Booked
          </span>
        </div>
      </div>

      {/* Subtle Mobile Scroll Cue (phones fit up to 4 courts without scrolling) */}
      {colCount > 4 && (
      <div className="md:hidden text-[11px] text-muted-foreground/80 px-4 py-2 border-b bg-muted/20 text-center font-medium flex items-center justify-center gap-1.5">
        <span>&larr; Swipe sideways to view all courts &rarr;</span>
      </div>
      )}

      {/* Loading overlay during date transitions */}
      {isFetching && (
        <div className="absolute inset-x-0 bottom-0 top-[60px] bg-background/60 backdrop-blur-[2px] z-30 flex items-center justify-center animate-in fade-in duration-200">
          <div className="flex items-center gap-2 bg-card border border-border shadow-md px-4 py-2 rounded-full text-xs font-semibold text-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            <span>Updating availability...</span>
          </div>
        </div>
      )}

      {/* Full Grid Matrix */}
      <div className="overflow-x-auto pb-2">
        <div
          className="min-w-[var(--grid-min)] md:min-w-[800px]"
          style={{ "--grid-min": `${76 + colCount * 75}px` } as React.CSSProperties}
        >
          {/* Grid Header */}
          <div className="grid grid-cols-[76px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] border-b">
            <div className="p-4 border-r font-medium text-sm flex items-center justify-center text-muted-foreground sticky left-0 z-20 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
              Time
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
            >
              {courts.map((court, i) => (
                <div key={i} className="p-4 text-center font-semibold border-l first:border-l-0 text-sm">
                  {court}
                </div>
              ))}
            </div>
          </div>

          {/* Grid Body */}
          <div className="divide-y">
            {passedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowPassed((v) => !v)}
                className="w-full py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center gap-1.5 transition-colors"
                aria-expanded={showPassed}
              >
                <ChevronDown className={`size-3.5 transition-transform ${showPassed ? "rotate-180" : ""}`} />
                {showPassed ? "Hide" : "Show"} {passedCount} earlier time {passedCount === 1 ? "slot" : "slots"}
              </button>
            )}
            {visibleSlots.map((time, timeIdx) => (
              <div key={timeIdx} className="grid grid-cols-[76px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] hover:bg-muted/30 transition-colors group">
                <div className="p-2 border-r flex items-center justify-center text-xs md:text-sm text-center font-medium sticky left-0 z-10 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] group-hover:bg-muted/30 transition-colors">
                  {time}
                </div>
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
                >
                  {courts.map((court, courtIdx) => {
                    const status = getSlotStatus(selectedDate, court, time);
                    const isSelected = Boolean(
                      selectedSlot &&
                      selectedSlot.court === court &&
                      (selectedSlot.time === time || (() => {
                        const [cellStart, cellEnd] = time.split(" - ").map((t) => to24h(t.trim()));
                        const [selStart, selEnd] = selectedSlot.time.split(" - ").map((t) => to24h(t.trim()));
                        return Boolean(cellStart && cellEnd && selStart && selEnd && cellStart >= selStart && cellEnd <= selEnd);
                      })())
                    );

                    return (
                      <div key={courtIdx} className="p-1 sm:p-2 border-l first:border-l-0 h-full">
                        {isSelected ? (
                          <button
                            type="button"
                            onClick={() => onSlotClick(court, time)}
                            aria-label={`Selected ${court} at ${time}. Click to deselect.`}
                            className="w-full h-full min-h-[48px] bg-primary text-primary-foreground rounded-lg transition-all duration-200 text-xs md:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-md hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <Check className="size-4" />
                            Selected
                          </button>
                        ) : status === "available" ? (
                          <button
                            type="button"
                            onClick={() => onSlotClick(court, time)}
                            aria-label={`Select ${court} at ${time}`}
                            className="w-full h-full min-h-[48px] bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground rounded-lg transition-all duration-200 text-xs md:text-sm font-semibold flex items-center justify-center border border-primary/30 shadow-xs hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            Available
                          </button>
                        ) : status === "user_pending" ? (
                          <button
                            type="button"
                            onClick={() => onSlotClick(court, time)}
                            aria-label={`Resume your pending booking for ${court} at ${time}`}
                            className="w-full h-full min-h-[48px] bg-amber-500/15 hover:bg-amber-500 text-amber-800 dark:text-amber-300 hover:text-white rounded-lg transition-all duration-200 text-xs md:text-sm font-bold flex items-center justify-center gap-1.5 border border-amber-500/40 hover:border-amber-500 shadow-xs hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                            title="Your pending reservation. Click to resume payment or cancel."
                          >
                            <Clock className="size-3.5" />
                            Resume
                          </button>
                        ) : status === "pending" ? (
                          <div
                            aria-label={`${court} at ${time} is pending confirmation`}
                            className="w-full h-full min-h-[48px] bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 rounded-lg flex items-center justify-center text-[10px] sm:text-xs md:text-sm cursor-not-allowed uppercase font-semibold tracking-normal sm:tracking-wider"
                          >
                            Pending
                          </div>
                        ) : (
                          <div
                            aria-label={`${court} at ${time} is ${status}`}
                            className="w-full h-full min-h-[48px] bg-muted/60 text-muted-foreground/80 dark:text-muted-foreground/60 rounded-lg flex items-center justify-center text-[10px] sm:text-xs md:text-sm cursor-not-allowed uppercase font-semibold tracking-normal sm:tracking-wider"
                          >
                            {status === "maintenance" ? "Maintenance" : status === "closed" ? "Closed" : status === "passed" ? "Passed" : "Booked"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
