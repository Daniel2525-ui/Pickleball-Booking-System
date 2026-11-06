import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Pricing } from "@/lib/services/pricing/quoteCourtPrice";
import { basketTotal, lineKey } from "@/lib/services/bookings/basket";
import { to24h } from "@/lib/services/bookings/checkSlotAvailability.service";
import { Slot } from "./types";

/** Keep in step with the max-h class below: the page pads its bottom by this much. */
export const BASKET_SHEET_PADDING = "pb-[28rem]";

interface BasketSheetProps {
  lines: Slot[];
  pricing: Pricing;
  /** Longest duration (hours) still free from the line's start slot */
  getMaxDuration: (line: Slot) => number;
  onDuration: (line: Slot, hours: number) => void;
  onRemove: (line: Slot) => void;
  onCheckout: () => void;
}

const hrs = (n: number) => `${n} ${n === 1 ? "hr" : "hrs"}`;
const startOf = (line: Slot) => to24h(line.time.split(" - ")[0].trim());

export const BasketSheet = ({ lines, pricing, getMaxDuration, onDuration, onRemove, onCheckout }: BasketSheetProps) => {
  if (lines.length === 0) return null;
  const { total, hasPeak } = basketTotal(lines);
  const { min_hours: minHours, max_hours: maxHours } = pricing.settings;
  const totalHours = lines.reduce((sum, l) => sum + (l.duration || 1), 0);

  // One block per court, courts in name order and times in clock order, whatever order they were tapped in
  const courts = [...new Set(lines.map((l) => l.court))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const timesOn = (court: string) => lines.filter((l) => l.court === court).sort((a, b) => startOf(a).localeCompare(startOf(b)));

  return (
    <section
      aria-label="Your selection"
      className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:w-[90%] sm:max-w-4xl z-50 max-h-[26rem] flex flex-col bg-card border-t sm:border sm:rounded-2xl shadow-[0_-15px_40px_-15px_rgba(0,0,0,0.15)] sm:shadow-2xl p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-8 duration-300"
    >
      <h3 className="text-sm font-extrabold text-foreground mb-1 shrink-0">
        Your selection{" "}
        <span className="font-semibold text-muted-foreground">
          · {courts.length} {courts.length === 1 ? "court" : "courts"}, {hrs(totalHours)} total
        </span>
      </h3>
      <div className="min-h-0 overflow-y-auto divide-y">
        {courts.map((court) => (
          <div key={court} className="py-2.5">
            <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{court}</p>
            <ul className="mt-1 flex flex-col gap-2">
              {timesOn(court).map((line) => {
                const maxAvailable = getMaxDuration(line);
                const duration = line.duration || 1;
                return (
                  <li key={lineKey(line)} role="group" aria-label={`${line.court} ${line.time} selection line`} className="flex items-center gap-2 sm:gap-3">
                    <p className="min-w-0 flex-1 text-sm font-black text-foreground tabular-nums">{line.time}</p>
                    {maxHours > minHours ? (
                      // One compact control instead of a button per length: the time row stays a single line
                      <div className="flex items-center rounded-lg border border-border bg-muted/40">
                        <button
                          type="button"
                          aria-label="One hour shorter"
                          disabled={duration <= minHours}
                          onClick={() => onDuration(line, duration - 1)}
                          className="grid size-10 sm:size-8 place-items-center rounded-l-lg text-foreground hover:bg-muted disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="min-w-12 text-center text-xs font-bold tabular-nums" aria-live="polite">{hrs(duration)}</span>
                        <button
                          type="button"
                          aria-label="One hour longer"
                          disabled={duration >= maxAvailable}
                          title={duration >= maxAvailable ? (duration >= maxHours ? "Longest booking allowed" : "The next hour on this court isn't free") : undefined}
                          onClick={() => onDuration(line, duration + 1)}
                          className="grid size-10 sm:size-8 place-items-center rounded-r-lg text-foreground hover:bg-muted disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">{hrs(duration)}</span>
                    )}
                    <div className="text-right">
                      <p className="text-sm font-black text-foreground tabular-nums">₱{line.price.toLocaleString()}</p>
                      {line.hasPeak && <p className="text-[11px] text-muted-foreground">peak rate</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-muted-foreground"
                      onClick={() => onRemove(line)}
                      aria-label={`Remove ${line.court} ${line.time}`}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-border/60 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">
              Total{hasPeak ? " · includes peak rate" : ""}
            </p>
            <p className="text-xl font-black text-foreground tabular-nums">₱{total.toLocaleString()}</p>
          </div>
          <Button onClick={onCheckout} size="lg" className="min-h-11 px-6 text-sm font-bold shadow-md">
            Continue to Checkout
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">You pay for everything here in one checkout, and it&apos;s all held together or not at all.</p>
      </div>
    </section>
  );
};
