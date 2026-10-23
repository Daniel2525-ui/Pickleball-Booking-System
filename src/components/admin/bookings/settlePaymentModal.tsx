"use client";

import { useState } from "react";
import { Loader2, Banknote, Smartphone, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { settleCounterPayment } from "@/lib/services/payments/settleCounterPayment.service";
import { Booking } from "@/lib/services/bookings/bookingsTypes";

interface SettlePaymentModalProps {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettled: (bookingId: string, updatedPayment: any) => void;
}

export const SettlePaymentModal = ({
  booking,
  open,
  onOpenChange,
  onSettled,
}: SettlePaymentModalProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "gcash">("cash");
  const [paymentReference, setPaymentReference] = useState("");

  if (!booking) return null;

  const payment = booking.payments?.[0];
  const amount = booking.total_amount || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment?.id) {
      setError("No pending payment record found for this reservation.");
      return;
    }

    setLoading(true);
    setError(null);

    const { success, data, error: settleErr } = await settleCounterPayment({
      paymentId: payment.id,
      bookingId: booking.id,
      paymentMethod,
      paymentReference: paymentMethod === "gcash" ? paymentReference : undefined,
    });

    setLoading(false);

    if (settleErr || !success) {
      setError(settleErr?.message || "Failed to settle payment.");
    } else {
      toast.success(`Payment of ₱${amount.toLocaleString()} received via ${paymentMethod.toUpperCase()}`);
      onSettled(booking.id, data);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <CheckCircle2 className="size-5 text-primary" />
            Collect Counter Payment
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Record customer payment for this reservation in the facility cash register.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {/* Booking Summary Box */}
          <div className="p-3 rounded-lg bg-muted/40 border border-border flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Player:</span>
              <span className="font-bold text-foreground">{booking.customer_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Court:</span>
              <span className="font-semibold text-primary">{booking.courts?.name || `Court ${booking.court_id}`}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-1.5 mt-0.5">
              <span className="font-semibold text-muted-foreground">Amount Due:</span>
              <span className="font-extrabold text-sm text-foreground">₱{amount.toLocaleString()}</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-foreground">Payment Received As</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  paymentMethod === "cash"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-bold"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Banknote className="size-4" />
                <span>Cash Payment</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("gcash")}
                className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  paymentMethod === "gcash"
                    ? "border-blue-500 bg-blue-500/10 text-blue-800 dark:text-blue-300 font-bold"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Smartphone className="size-4" />
                <span>GCash Transfer</span>
              </button>
            </div>
          </div>

          {/* Optional GCash Reference Field */}
          {paymentMethod === "gcash" && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] font-medium text-muted-foreground">
                GCash Reference Code (Optional)
              </Label>
              <Input
                type="text"
                placeholder="e.g. 1029384756"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          <DialogFooter className="mt-4 pt-2 border-t">
            <Button
              type="submit"
              disabled={loading}
              className="w-full sm:w-auto font-bold text-xs sm:text-sm gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                `Confirm ₱${amount.toLocaleString()} Received`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
