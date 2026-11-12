import { useState } from "react";
import { useVenueContact } from "@/hooks/use-venue-contact";
import { AlertCircle, LoaderCircle, MapPin, QrCode } from "lucide-react";
import Link from "next/link";
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
import { VENUE_NAME } from "@/lib/brand";

interface BookingModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lines: Slot[];
  isLoading?: boolean;
  error?: string | null;
  onConfirm: () => void;
}

const hrs = (n: number) => `${n} ${n === 1 ? "hour" : "hours"}`;

/** Checkout: what is being bought, how QR Ph payment works, the policy, and one button that names the amount. */
export const BookingModal = ({ isOpen, onOpenChange, lines, isLoading, error, onConfirm }: BookingModalProps) => {
  const venue = useVenueContact();
  const [agreed, setAgreed] = useState(true);
  const { total, hasPeak } = basketTotal(lines);
  const totalHours = lines.reduce((sum, l) => sum + (l.duration || 1), 0);
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="p-5 sm:p-6 border-b">
          <DialogTitle className="text-2xl font-bold">Review and pay</DialogTitle>
          <DialogDescription>
            {lines.length} {lines.length === 1 ? "court" : "courts"} · {hrs(totalHours)} · {VENUE_NAME}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section aria-label="Your booking" className="flex flex-col gap-3">
            {lines.length > 0 && (
              <p className="text-sm font-semibold">
                {lines[0].date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <li key={`${line.court}|${line.time}`} className="rounded-xl border p-3.5 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{line.court}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {line.time} · {hrs(line.duration || 1)}
                      {line.hasPeak && " · peak"}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums">₱{line.price.toLocaleString()}</p>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">Total{hasPeak ? " · includes peak rate" : ""}</span>
              <span className="font-display text-3xl font-bold tabular-nums">₱{total.toLocaleString()}</span>
            </div>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0 text-primary mt-0.5" aria-hidden />
              <span>{VENUE_NAME}, {venue.address}</span>
            </p>
          </section>

          <div className="flex flex-col gap-4">
            <section aria-label="Payment method" className="rounded-xl border-2 border-primary bg-primary/5 p-4 flex gap-3">
              <QrCode className="size-6 text-primary shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Pay with QR Ph</p>
                <p className="text-sm text-muted-foreground">GCash, Maya or any bank app. No fee.</p>
                <ol className="mt-2 list-decimal pl-4 text-sm text-muted-foreground space-y-0.5">
                  <li>Tap <b className="text-foreground">Pay</b> and a QR code appears.</li>
                  <li>Scan it in your app, or save it and upload it from your photos.</li>
                  <li>Keep the page open. We confirm your booking automatically.</li>
                </ol>
              </div>
            </section>

            <section aria-label="Before you pay" className="text-sm flex flex-col gap-2">
              <p><b>Paid bookings can&apos;t be cancelled online.</b> To move one, call {venue.phone}.</p>
              <p className="text-muted-foreground">Your courts are held for 15 minutes while you pay. Please arrive 10 minutes early.</p>
              <label className="flex items-center gap-2.5 min-h-11 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 accent-[var(--primary)]" />
                <span>
                  I agree to the <Link href="/terms" className="font-semibold text-primary underline underline-offset-4">booking rules</Link>
                </span>
              </label>
            </section>
          </div>
        </div>

        {error && (
          <div role="alert" className="mx-5 sm:mx-6 mb-4 bg-destructive/10 text-destructive text-sm p-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 p-5 sm:p-6 border-t bg-muted/30">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto h-12 font-semibold" disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm()} className="w-full sm:w-auto h-12 px-6 text-base font-semibold gap-2" disabled={isLoading || !agreed}>
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <QrCode className="size-4" />}
            {isLoading ? "Creating your QR code..." : `Pay ₱${total.toLocaleString()} with QR Ph`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
