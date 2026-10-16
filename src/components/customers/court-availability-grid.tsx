"use client";

import { useState } from "react";
import { Clock, Check, ChevronRight, Layers, SlidersHorizontal } from "lucide-react";
import { Slot } from "./types";
import { SlotStatus } from "@/lib/services/bookings/checkSlotAvailability.service";

interface CourtAvailabilityGridProps {
  selectedDate: Date;
  courts: string[];
  timeSlots: string[];
  onSlotClick: (court: string, time: string) => void;
  getSlotStatus: (date: Date, court: string, time: string) => SlotStatus;
  selectedSlot?: Slot | null;
}

export const CourtAvailabilityGrid = ({
  selectedDate,
  courts,
  timeSlots,
  onSlotClick,
  getSlotStatus,
  selectedSlot,
}: CourtAvailabilityGridProps) => {
  const colCount = courts.length;
  const [mobileCourt, setMobileCourt] = useState<string>("all");

  return (
    <div className="bg-card border rounded-2xl shadow-sm overflow-hidden flex-1">
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

      {/* Mobile Court Selector Filter (Visible on < md screens) */}
      <div className="md:hidden border-b px-3 py-2.5 bg-muted/15 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mr-1 shrink-0 flex items-center gap-1">
          <SlidersHorizontal className="size-3 text-primary" /> Court:
        </span>
        <button
          type="button"
          onClick={() => setMobileCourt("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
            mobileCourt === "all"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          All Courts Matrix
        </button>
        {courts.map((court) => (
          <button
            key={court}
            type="button"
            onClick={() => setMobileCourt(court)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
              mobileCourt === court
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {court}
          </button>
        ))}
      </div>

      {/* Dedicated Single-Court Vertical Touch Flow for Mobile */}
      {mobileCourt !== "all" ? (
        <div className="md:hidden divide-y divide-border/60 p-2">
          <div className="p-3 bg-muted/20 rounded-xl mb-2 flex items-center justify-between text-xs">
            <span className="font-bold text-foreground flex items-center gap-1.5">
              <Layers className="size-3.5 text-primary" /> {mobileCourt} Slots
            </span>
            <span className="text-muted-foreground">
              {timeSlots.filter((t) => getSlotStatus(selectedDate, mobileCourt, t) === "available").length} slots open
            </span>
          </div>

          {timeSlots.map((time, idx) => {
            const status = getSlotStatus(selectedDate, mobileCourt, time);
            const isSelected = selectedSlot?.court === mobileCourt && selectedSlot?.time === time;

            return (
              <div
                key={idx}
                className="py-2.5 px-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors rounded-xl"
              >
                <div className="flex flex-col">
                  <span className="font-bold text-sm text-foreground">{time}</span>
                  <span className="text-[11px] text-muted-foreground">1-Hour Session</span>
                </div>

                <div className="shrink-0 w-32">
                  {isSelected ? (
                    <button
                      type="button"
                      onClick={() => onSlotClick(mobileCourt, time)}
                      className="w-full min-h-[44px] bg-primary text-primary-foreground rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform"
                    >
                      <Check className="size-4" /> Selected
                    </button>
                  ) : status === "available" ? (
                    <button
                      type="button"
                      onClick={() => onSlotClick(mobileCourt, time)}
                      className="w-full min-h-[44px] bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/30 rounded-xl text-xs font-bold flex items-center justify-center shadow-2xs active:scale-95 transition-all"
                    >
                      Book Slot
                    </button>
                  ) : status === "user_pending" ? (
                    <button
                      type="button"
                      onClick={() => onSlotClick(mobileCourt, time)}
                      className="w-full min-h-[44px] bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold flex items-center justify-center gap-1 shadow-2xs active:scale-95 transition-all"
                    >
                      <Clock className="size-3" /> Resume
                    </button>
                  ) : status === "pending" ? (
                    <div className="w-full min-h-[44px] bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-xl flex items-center justify-center text-xs font-medium cursor-not-allowed">
                      Pending
                    </div>
                  ) : (
                    <div className="w-full min-h-[44px] bg-muted/40 text-muted-foreground/60 rounded-xl flex items-center justify-center text-xs font-medium cursor-not-allowed">
                      {status === "maintenance" ? "Maintenance" : status === "closed" ? "Closed" : status === "passed" ? "Passed" : "Booked"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Full Grid Matrix (Desktop + Mobile "All Courts" view) */
        <div className="overflow-x-auto pb-2">
          {/* Subtle Mobile Scroll Cue */}
          <div className="md:hidden text-[11px] text-muted-foreground/75 px-4 py-2 border-b bg-muted/10 text-center font-medium">
            &larr; Swipe horizontally to view all courts &rarr;
          </div>

          <div className="min-w-[600px] md:min-w-[800px]">
            {/* Grid Header */}
            <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] border-b">
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
              {timeSlots.map((time, timeIdx) => (
                <div key={timeIdx} className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] hover:bg-muted/30 transition-colors group">
                  <div className="p-2 border-r flex items-center justify-center text-xs md:text-sm text-center font-medium sticky left-0 z-10 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] group-hover:bg-muted/30 transition-colors">
                    {time}
                  </div>
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
                  >
                    {courts.map((court, courtIdx) => {
                      const status = getSlotStatus(selectedDate, court, time);
                      const isSelected = selectedSlot?.court === court && selectedSlot?.time === time;

                      return (
                        <div key={courtIdx} className="p-2 border-l first:border-l-0 h-full">
                          {isSelected ? (
                            <button
                              type="button"
                              onClick={() => onSlotClick(court, time)}
                              className="w-full h-full min-h-[48px] bg-primary text-primary-foreground rounded-lg transition-all duration-200 text-xs md:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-md hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <Check className="size-4" />
                              Selected
                            </button>
                          ) : status === "available" ? (
                            <button
                              type="button"
                              onClick={() => onSlotClick(court, time)}
                              className="w-full h-full min-h-[48px] bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground rounded-lg transition-all duration-200 text-xs md:text-sm font-semibold flex items-center justify-center border border-primary/30 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              Available
                            </button>
                          ) : status === "user_pending" ? (
                            <button
                              type="button"
                              onClick={() => onSlotClick(court, time)}
                              className="w-full h-full min-h-[48px] bg-amber-500/15 hover:bg-amber-500 text-amber-800 dark:text-amber-300 hover:text-white rounded-lg transition-all duration-200 text-xs md:text-sm font-bold flex items-center justify-center gap-1.5 border border-amber-500/40 hover:border-amber-500 shadow-xs hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                              title="Your pending reservation. Click to resume payment or cancel."
                            >
                              <Clock className="size-3.5" />
                              Resume
                            </button>
                          ) : status === "pending" ? (
                            <div className="w-full h-full min-h-[48px] bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg flex items-center justify-center text-xs md:text-sm cursor-not-allowed uppercase font-semibold tracking-wider">
                              Pending
                            </div>
                          ) : (
                            <div className="w-full h-full min-h-[48px] bg-muted/50 rounded-lg flex items-center justify-center text-muted-foreground/60 text-xs md:text-sm cursor-not-allowed uppercase font-semibold tracking-wider">
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
      )}
    </div>
  );
};
