import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Pricing } from "@/lib/services/pricing/quoteCourtPrice";
import { basketTotal, lineKey } from "@/lib/services/bookings/basket";
import { Slot } from "./types";

/** Keep in step with the max-h class below: the page pads its bottom by this much. */
export const BASKET_SHEET_PADDING = "pb-96";

interface BasketSheetProps {
  lines: Slot[];
  pricing: Pricing;
  /** Longest duration (hours) still free from the line's start slot */
  getMaxDuration: (line: Slot) => number;
  onDuration: (line: Slot, hours: number) => void;
  onRemove: (line: Slot) => void;
  onCheckout: () => void;
}

export const BasketSheet = ({ lines, pricing, getMaxDuration, onDuration, onRemove, onCheckout }: BasketSheetProps) => {
  if (lines.length === 0) return null;
  const { total, hasPeak } = basketTotal(lines);
  const { min_hours: minHours, max_hours: maxHours } = pricing.settings;

  return (
    <section
      aria-label="Your selection"
      className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:w-[90%] sm:max-w-4xl z-50 max-h-80 flex flex-col bg-card border-t sm:border sm:rounded-2xl shadow-[0_-15px_40px_-15px_rgba(0,0,0,0.15)] sm:shadow-2xl p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-8 duration-300"
    >
      <h3 className="text-xs sm:text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2 shrink-0">
        Your selection · {lines.length} {lines.length === 1 ? "time slot" : "time slots"}
      </h3>
      <ul className="divide-y min-h-0 overflow-y-auto">
        {lines.map((line) => {
          const maxAvailable = getMaxDuration(line);
          return (
            // Phones: court, price and remove on top, duration buttons on a full-width row below
            <li key={lineKey(line)} role="group" aria-label={`${line.court} ${line.time} selection line`} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-foreground">{line.court}</p>
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{line.time}</p>
              </div>
              <div className="order-last flex w-full gap-1.5 sm:order-0 sm:w-auto">
                {Array.from({ length: maxHours - minHours + 1 }, (_, i) => minHours + i).map((hours) => {
                  const isAvailable = hours <= maxAvailable;
                  return (
                    <button
                      key={hours}
                      type="button"
                      disabled={!isAvailable}
                      aria-pressed={(line.duration || 1) === hours}
                      onClick={() => onDuration(line, hours)}
                      title={isAvailable ? undefined : "Consecutive slot unavailable"}
                      className={`h-10 flex-1 whitespace-nowrap px-1 sm:h-9 sm:flex-none sm:px-2.5 rounded-lg text-xs font-bold transition-all ${
                        (line.duration || 1) === hours
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : isAvailable
                          ? "bg-muted hover:bg-muted/80 text-foreground border border-border"
                          : "opacity-35 cursor-not-allowed bg-muted/40 text-muted-foreground border border-border/40"
                      }`}
                    >
                      {hours} {hours === 1 ? "hr" : "hrs"}
                    </button>
                  );
                })}
              </div>
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
        <p className="mt-2 text-[11px] text-muted-foreground">All time slots are held together, or none.</p>
      </div>
    </section>
  );
};
