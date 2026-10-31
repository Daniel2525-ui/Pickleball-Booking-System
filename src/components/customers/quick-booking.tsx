"use client";

import { useState } from "react";
import { Slot } from "./types";
import { DateSelector } from "./date-selector";
import { OperatingHour } from "@/components/admin/schedules/types";
import { SlotStatus, to24h } from "@/lib/services/bookings/checkSlotAvailability.service";
import { compactRange, pickCourts, quickStarts } from "@/lib/services/bookings/quickStarts";

interface QuickBookingProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  operatingHours: OperatingHour[];
  courts: string[];
  timeSlots: string[];
  getSlotStatus: (date: Date, court: string, time: string) => SlotStatus;
  minHours: number;
  maxHours: number;
  baseRate: number;
  priceFor: (date: Date, startSlotTime: string, duration: number) => { total: number; hasPeak: boolean };
  onBook: (lines: Slot[]) => void;
  onOpenBoard: () => void;
}

const PARTS = [
  { label: "Morning", until: 12 },
  { label: "Afternoon", until: 17 },
  { label: "Evening", until: 24 },
];

const peso = (n: number) => `₱${n.toLocaleString()}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const QuickBooking = ({
  selectedDate,
  onSelectDate,
  operatingHours,
  courts,
  timeSlots,
  getSlotStatus,
  minHours,
  maxHours,
  baseRate,
  priceFor,
  onBook,
  onOpenBoard,
}: QuickBookingProps) => {
  const [wanted, setWanted] = useState(1);
  const [hours, setHours] = useState(minHours);
  // The picked start belongs to one date; changing day drops it without an effect
  const [start, setStart] = useState<{ day: string; slot: string } | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [showCourts, setShowCourts] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const dayKey = selectedDate.toDateString();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const starts = quickStarts(timeSlots, courts, hours, (court, slot) => getSlotStatus(selectedDate, court, slot) === "available");
  const isPassed = (slot: string) => courts.every((court) => getSlotStatus(selectedDate, court, slot) === "passed");
  const upcoming = starts.filter((s) => !isPassed(s.slot));
  const picked = start?.day === dayKey ? upcoming.find((s) => s.slot === start.slot && s.freeCourts.length >= wanted) : undefined;
  const pickedCourts = picked ? pickCourts(picked.freeCourts, chosen, wanted) : [];
  const quote = picked ? priceFor(selectedDate, picked.slot, hours) : null;
  const total = quote ? quote.total * pickedCourts.length : 0;

  const book = () => {
    if (!picked || !quote) return;
    const startPart = picked.slot.split(" - ")[0].trim();
    const endPart = timeSlots[picked.index + hours - 1].split(" - ")[1].trim();
    onBook(
      pickedCourts.map((court) => ({
        date: selectedDate,
        court,
        time: `${startPart} - ${endPart}`,
        price: quote.total,
        hasPeak: quote.hasPeak,
        duration: hours,
        startSlot: picked.slot,
      }))
    );
  };

  const option = (pressed: boolean) =>
    `flex flex-col items-start text-left rounded-xl border-[1.5px] px-3 py-2.5 min-h-[56px] transition-colors ${
      pressed ? "border-primary bg-primary/10" : "border-border bg-background hover:border-muted-foreground/50"
    }`;

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <fieldset className="rounded-2xl border bg-card p-4 flex flex-col gap-3 min-w-0">
            <legend className="sr-only">Which day?</legend>
            <h3 aria-hidden className="text-base font-extrabold flex items-center gap-2.5"><Step n={1} />Which day?</h3>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
              {days.map((d, i) => {
                const pressed = d.toDateString() === dayKey;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => onSelectDate(d)}
                    className={`shrink-0 flex flex-col items-center min-w-[56px] px-3 py-1.5 rounded-xl border transition-colors ${
                      pressed ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">
                      {i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className="font-display text-2xl font-extrabold leading-none mt-0.5">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-expanded={showCalendar}
              onClick={() => setShowCalendar((v) => !v)}
              className="self-start min-h-[44px] text-sm font-semibold text-muted-foreground"
            >
              {days.some((d) => d.toDateString() === dayKey)
                ? "Another date?"
                : `${selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ·`}{" "}
              <span className="font-extrabold text-primary underline underline-offset-4">{showCalendar ? "Hide the calendar" : "Open the calendar"}</span>
            </button>
            {showCalendar && (
              <DateSelector
                selectedDate={selectedDate}
                onSelectDate={(d) => {
                  onSelectDate(d);
                  setShowCalendar(false);
                }}
                operatingHours={operatingHours}
              />
            )}
          </fieldset>

          <fieldset className="rounded-2xl border bg-card p-4 flex flex-col gap-3">
            <legend className="sr-only">How many courts?</legend>
            <h3 aria-hidden className="text-base font-extrabold flex items-center gap-2.5"><Step n={2} />How many courts?</h3>
            <div className="grid grid-cols-2 gap-2">
              {courts.map((_, i) => (
                <button key={i} type="button" aria-pressed={wanted === i + 1} onClick={() => setWanted(i + 1)} className={option(wanted === i + 1)}>
                  <span className="font-bold">{plural(i + 1, "court")}</span>
                  <span className={`text-xs font-bold ${wanted === i + 1 ? "text-primary" : "text-muted-foreground"}`}>{peso((i + 1) * baseRate)}/hr</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border bg-card p-4 flex flex-col gap-3">
            <legend className="sr-only">How long?</legend>
            <h3 aria-hidden className="text-base font-extrabold flex items-center gap-2.5"><Step n={3} />How long?</h3>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: maxHours - minHours + 1 }, (_, i) => minHours + i).map((h) => (
                <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)} className={option(hours === h)}>
                  <span className="font-bold">{plural(h, "hour")}</span>
                  <span className={`text-xs font-bold ${hours === h ? "text-primary" : "text-muted-foreground"}`}>{peso(h * baseRate * wanted)}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <section aria-labelledby="pick-start" className="rounded-2xl border bg-card p-4 flex flex-col gap-4 min-w-0">
          <h3 id="pick-start" className="text-base font-extrabold flex items-center gap-2.5"><Step n={4} />Pick a start time</h3>
          {timeSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground">The venue is closed on this date. Please select another date.</p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No more start times on this day. Try another day.</p>
          ) : (
            <>
              {upcoming.length < starts.length && <p className="text-xs font-semibold text-muted-foreground">Earlier times today have passed.</p>}
              {PARTS.map((part, p) => {
                const from = p === 0 ? 0 : PARTS[p - 1].until;
                const inPart = upcoming.filter((s) => {
                  const h = parseInt(to24h(s.slot.split(" - ")[0].trim()), 10);
                  return h >= from && h < part.until;
                });
                if (inPart.length === 0) return null;
                const open = inPart.filter((s) => s.freeCourts.length >= wanted);
                const full = inPart.length - open.length;
                return (
                  <div key={part.label} className="flex flex-col gap-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
                      {part.label}
                      {full > 0 && (
                        <span className="normal-case tracking-normal font-semibold">
                          {" "}· {full === inPart.length ? "all full" : `${plural(full, "full time")} hidden`}
                        </span>
                      )}
                    </h4>
                    {open.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                        {open.map((s) => {
                          const pressed = picked?.slot === s.slot;
                          const last = s.freeCourts.length === wanted;
                          const peak = priceFor(selectedDate, s.slot, hours).hasPeak;
                          const label = compactRange(timeSlots, s.index, hours);
                          return (
                            <button
                              key={s.slot}
                              type="button"
                              aria-pressed={pressed}
                              aria-label={`${label}, ${plural(s.freeCourts.length, "court")} free${peak ? ", peak rate" : ""}`}
                              onClick={() => setStart(pressed ? null : { day: dayKey, slot: s.slot })}
                              className={`flex flex-col items-start text-left rounded-xl border-[1.5px] px-3 py-2.5 min-h-[64px] transition-colors ${
                                pressed ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border hover:border-primary"
                              }`}
                            >
                              <span className="font-extrabold tabular-nums">{label}</span>
                              <span className={`text-[11px] font-extrabold mt-1 ${pressed ? "" : last ? "text-amber-400" : "text-primary"}`}>
                                {last ? (wanted === 1 ? "Last court" : "Last courts") : `${s.freeCourts.length} courts free`}
                                {peak ? " · peak" : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {picked && (
            <div className="border-t pt-3 flex flex-col gap-3">
              <p className="text-sm">
                You&apos;ll play on <b>{pickedCourts.join(" and ")}</b>. All courts are the same size and surface.{" "}
                {!showCourts && (
                  <button type="button" onClick={() => setShowCourts(true)} className="font-bold text-primary underline underline-offset-4">
                    Choose courts yourself
                  </button>
                )}
              </p>
              {showCourts && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Courts">
                  {courts.map((court) => {
                    const free = picked.freeCourts.includes(court);
                    const on = pickedCourts.includes(court);
                    return (
                      <button
                        key={court}
                        type="button"
                        disabled={!free}
                        aria-pressed={on}
                        // Swapping in a court drops the earliest pick, so the count stays what step 2 asked for
                        onClick={() => !on && setChosen([...pickedCourts.slice(1), court])}
                        className={`flex flex-col items-start rounded-xl border-2 px-3 py-2 min-h-[56px] text-left font-extrabold ${
                          on ? "bg-primary border-primary text-primary-foreground" : free ? "bg-background border-border" : "border-dashed border-border text-muted-foreground cursor-not-allowed"
                        }`}
                      >
                        {court}
                        <span className="text-[11px] font-bold opacity-80">{on ? "Yours" : free ? "Tap to switch" : "Taken"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <button type="button" onClick={onOpenBoard} className="self-start min-h-[44px] text-sm font-semibold text-muted-foreground text-left">
            Different times per court? <span className="font-extrabold text-primary underline underline-offset-4">See the full board</span>
          </button>
        </section>
      </div>

      <div className="sticky bottom-0 z-20 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div
          role="region"
          aria-label="Booking summary"
          className={`rounded-2xl pl-4 pr-2 py-2 flex items-center justify-between gap-3 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)] ${
            picked ? "bg-foreground text-background" : "bg-card border"
          }`}
        >
          <div className="min-w-0 leading-tight">
            <p className="text-base sm:text-lg font-extrabold">{picked ? compactRange(timeSlots, picked.index, hours) : "Pick a start time"}</p>
            <p className="text-xs font-bold opacity-75 truncate">
              {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {plural(wanted, "court")} · {plural(hours, "hour")}
              {picked ? ` · ${peso(total)}${quote?.hasPeak ? " incl. peak" : ""}` : ""}
            </p>
          </div>
          <button
            type="button"
            disabled={!picked}
            onClick={book}
            className="shrink-0 rounded-xl bg-primary text-primary-foreground font-extrabold px-5 min-h-[48px] disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
          >
            {picked ? `Book · ${peso(total)}` : "Book"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const Step = ({ n }: { n: number }) => (
  <span aria-hidden className="size-6 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-extrabold">
    {n}
  </span>
);
