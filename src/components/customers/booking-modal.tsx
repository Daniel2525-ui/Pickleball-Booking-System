import { useState } from "react";
import { VENUE_CONTACT } from "@/lib/venue";
import { Clock, MapPin, Calendar, LoaderCircle, AlertCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { basketTotal } from "@/lib/services/bookings/basket";
import { Slot } from "./types";

interface BookingModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lines: Slot[];
  isLoading?: boolean;
  error?: string | null;
  gcashEnabled: boolean;
  onConfirm: (paymentMethod: "card" | "gcash") => void;
}

export const BookingModal = ({
  isOpen,
  onOpenChange,
  lines,
  isLoading,
  error,
  gcashEnabled,
  onConfirm,
}: BookingModalProps) => {
  const [method, setMethod] = useState<"card" | "gcash">("card");
  const { total, hasPeak } = basketTotal(lines);
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Reservation</DialogTitle>
          <DialogDescription>
            Review your booking details before proceeding to payment.
          </DialogDescription>
        </DialogHeader>

        {lines.length > 0 && (
          <div className="bg-muted p-4 rounded-xl my-4 space-y-3">
            <div className="flex items-center text-sm text-muted-foreground gap-1">
              <Calendar className="size-3.5" />
              {lines[0].date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <ul className="space-y-2">
              {lines.map((line) => (
                <li key={line.court} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{line.court}</p>
                    <div className="flex items-center text-sm text-muted-foreground mt-0.5 gap-1.5 flex-wrap">
                      <Clock className="size-3.5 text-primary" />
                      <span>{line.time}</span>
                      {(line.duration || 1) > 1 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          {line.duration} Hours
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="font-bold">₱{line.price.toLocaleString()}</p>
                </li>
              ))}
            </ul>
            <div className="pt-3 border-t flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Total{hasPeak ? " · includes peak rate" : ""}
              </span>
              <span className="text-2xl font-bold">₱{total.toLocaleString()}</span>
            </div>
            <div className="pt-3 border-t flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0 text-primary" />
              <span>Crosshair Dinkers, {VENUE_CONTACT.address}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md flex items-start gap-2 mb-4">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {gcashEnabled && (
          <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2">
            {(["card", "gcash"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={`h-11 rounded-xl border text-sm font-bold ${method === m ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
              >
                {m === "card" ? "Card" : "GCash"}
              </button>
            ))}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto h-11 text-sm font-semibold" disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(gcashEnabled ? method : "card")} className="w-full sm:w-auto h-11 text-sm font-bold gap-2" disabled={isLoading}>
            {isLoading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Lock className="size-4" />
            )}
            {isLoading ? "Redirecting..." : "Continue to Checkout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
