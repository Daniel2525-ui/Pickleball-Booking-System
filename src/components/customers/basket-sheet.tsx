import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Pricing } from "@/lib/services/pricing/quoteCourtPrice";
import { basketTotal, lineKey } from "@/lib/services/bookings/basket";
import { Slot } from "./types";

/** Below lg the panel floats over the page bottom: the page pads by this much (keep in step with max-h below). */
export const BASKET_SHEET_PADDING = "pb-[28rem] lg:pb-0";

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

/**
 * "Your selection": a sticky panel beside the grid from lg up (with an empty state), and below lg a panel over
 * the bottom of the screen, above the phone tab bar, only while something is picked.
 */
export const BasketSheet = ({ lines, pricing, getMaxDuration, onDuration, onRemove, onCheckout }: BasketSheetProps) => {
  if (lines.length === 0) {
    return (
      <section aria-label="Your selection" className="hidden lg:flex flex-col gap-3 rounded-2xl border bg-card p-5 sticky top-20">
        <h3 className="text-lg font-bold">Your selection</h3>
        <div className="rounded-xl border-[1.5px] border-dashed p-6 text-center">
          <p className="font-semibold">Nothing picked yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Tap a price in the grid to start. Tap the next hour to make it longer.</p>
        </div>
        <p className="text-xs text-muted-foreground">We hold your courts for 15 minutes while you pay with QR Ph.</p>
      </section>
    );
  }
  const { total, hasPeak } = basketTotal(lines);
  const { min_hours: minHours } = pricing.settings;
  const totalHours = lines.reduce((sum, l) => sum + (l.duration || 1), 0);

  // One block per court, courts in name order; a court's lines are already in grid order (12 AM after 11 PM)
  const courts = [...new Set(lines.map((l) => l.court))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const timesOn = (court: string) => lines.filter((l) => l.court === court);

  return (
    <section
      aria-label="Your selection"
      className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-0 z-40 max-h-[26rem] flex flex-col bg-card border-t shadow-[0_-12px_32px_-12px_rgba(17,24,22,0.18)] p-4 md:pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-8 duration-300 lg:static lg:sticky lg:top-20 lg:z-auto lg:max-h-[calc(100vh-6rem)] lg:rounded-2xl lg:border lg:shadow-xs lg:p-5 lg:animate-none"
    >
      <h3 className="text-base lg:text-lg font-bold text-foreground mb-1 shrink-0">
        Your selection{" "}
        <span className="font-semibold text-muted-foreground">
          · {courts.length} {courts.length === 1 ? "court" : "courts"}, {hrs(totalHours)} total
        </span>
      </h3>
      <div className="min-h-0 max-h-32 lg:max-h-none overflow-y-auto divide-y">
        {courts.map((court) => (
          <div key={court} className="py-2.5">
            <p className="text-sm font-bold text-foreground">{court}</p>
            <ul className="mt-1 flex flex-col gap-2">
              {timesOn(court).map((line) => {
                const maxAvailable = getMaxDuration(line);
                const duration = line.duration || 1;
                return (
                  <li key={lineKey(line)} role="group" aria-label={`${line.court} ${line.time} selection line`} className="flex items-center gap-2 sm:gap-3">
                    <p className="min-w-0 flex-1 text-sm font-semibold text-foreground tabular-nums">{line.time}</p>
                    {/* One compact control instead of a button per length: the time row stays a single line */}
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
                        title={duration >= maxAvailable ? "The next hour on this court isn't free" : undefined}
                        onClick={() => onDuration(line, duration + 1)}
                        className="grid size-10 sm:size-8 place-items-center rounded-r-lg text-foreground hover:bg-muted disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground tabular-nums">₱{line.price.toLocaleString()}</p>
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
            <p className="font-display text-2xl font-bold text-foreground tabular-nums">₱{total.toLocaleString()}</p>
          </div>
          <Button onClick={onCheckout} size="lg" className="min-h-12 px-6 text-base font-semibold lg:hidden">
            Continue to Checkout
          </Button>
        </div>
        <Button onClick={onCheckout} size="lg" className="hidden lg:flex mt-3 w-full min-h-12 text-base font-semibold">
          Continue to Checkout
        </Button>
        <p className="hidden lg:block mt-2 text-[11px] text-muted-foreground">You pay for everything here in one checkout, and it&apos;s all held together or not at all.</p>
      </div>
    </section>
  );
};
