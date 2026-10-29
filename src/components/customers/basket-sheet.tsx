import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Pricing } from "@/lib/services/pricing/quoteCourtPrice";
import { basketTotal } from "@/lib/services/bookings/basket";
import { Slot } from "./types";

/** Keep in step with the max-h class below: the page pads its bottom by this much. */
export const BASKET_SHEET_PADDING = "pb-80";

interface BasketSheetProps {
  lines: Slot[];
  pricing: Pricing;
  /** Longest duration (hours) still free from the line's start slot */
  getMaxDuration: (line: Slot) => number;
  onDuration: (court: string, hours: number) => void;
  onRemove: (court: string) => void;
  onCheckout: () => void;
}

export const BasketSheet = ({ lines, pricing, getMaxDuration, onDuration, onRemove, onCheckout }: BasketSheetProps) => {
  if (lines.length === 0) return null;
  const { total, hasPeak } = basketTotal(lines);
  const { min_hours: minHours, max_hours: maxHours } = pricing.settings;

  return (
    <section
      aria-label="Your basket"
      className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:w-[90%] sm:max-w-4xl z-50 max-h-72 flex flex-col bg-card border-t sm:border sm:rounded-2xl shadow-[0_-15px_40px_-15px_rgba(0,0,0,0.15)] sm:shadow-2xl p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-8 duration-300"
    >
      <h3 className="text-xs sm:text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2 shrink-0">
        Your basket · {lines.length} {lines.length === 1 ? "court" : "courts"}
      </h3>
      <ul className="divide-y min-h-0 overflow-y-auto">
        {lines.map((line) => {
          const maxAvailable = getMaxDuration(line);
          return (
            <li key={line.court} role="group" aria-label={`${line.court} basket line`} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-foreground">{line.court}</p>
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{line.time}</p>
              </div>
              <div className="flex items-center gap-1">
                {Array.from({ length: maxHours - minHours + 1 }, (_, i) => minHours + i).map((hours) => {
                  const isAvailable = hours <= maxAvailable;
                  return (
                    <button
                      key={hours}
                      type="button"
                      disabled={!isAvailable}
                      aria-pressed={(line.duration || 1) === hours}
                      onClick={() => onDuration(line.court, hours)}
                      title={isAvailable ? undefined : "Consecutive slot unavailable"}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
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
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-muted-foreground"
                onClick={() => onRemove(line.court)}
                aria-label={`Remove ${line.court}`}
              >
                <X className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/60 shrink-0">
        <div>
          <p className="text-[11px] text-muted-foreground">
            Total{hasPeak ? " · includes peak rate" : ""}
          </p>
          <p className="text-xl font-black text-foreground">₱{total.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground">All courts are held together, or none.</p>
        </div>
        <Button onClick={onCheckout} size="lg" className="min-h-[44px] px-6 text-sm font-bold shadow-md">
          Continue to Checkout
        </Button>
      </div>
    </section>
  );
};
