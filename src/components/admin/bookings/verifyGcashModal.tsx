"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertCircle, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { verifyGcashPayment } from "@/lib/services/payments/verifyGcashPayment.service";
import { Booking } from "@/lib/services/bookings/bookingsTypes";

interface VerifyGcashModalProps {
  booking: Booking | null;
  /** Every court of the submitted basket and their total */
  due: { ids: string[]; total: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (bookingIds: string[], action: "approve" | "reject") => void;
}

export const VerifyGcashModal = ({ booking, due, open, onOpenChange, onVerified }: VerifyGcashModalProps) => {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  const payment = booking ? (Array.isArray(booking.payments) ? booking.payments[0] : booking.payments) : null;
  const paymentId = payment?.id;
  const reference = payment?.payment_reference;
  const proofPath = payment?.gcash_proof_path;

  useEffect(() => {
    if (!open || !paymentId) return;
    let stale = false;
    if (proofPath) {
      supabase.storage
        .from("gcash-receipts")
        .createSignedUrl(proofPath, 300)
        .then(({ data }) => !stale && setProofUrl(data?.signedUrl ?? null));
    }
    if (reference) {
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("payment_reference", reference)
        .eq("payment_method", "gcash")
        .neq("id", paymentId)
        .then(({ count }) => !stale && setDuplicate((count ?? 0) > 0));
    }
    return () => {
      stale = true;
    };
  }, [open, paymentId, proofPath, reference]);

  if (!booking || !due) return null;

  const courts = due.ids.length;
  const submittedAt = payment?.gcash_submitted_at
    ? new Date(payment.gcash_submitted_at).toLocaleString("en-US", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })
    : "—";

  const decide = async (action: "approve" | "reject") => {
    if (!booking.basket_id) return;
    setLoading(action);
    setError(null);
    const { error: verifyErr } = await verifyGcashPayment(booking.basket_id, action);
    setLoading(null);
    if (verifyErr) {
      setError(verifyErr.message);
      return;
    }
    toast.success(action === "approve" ? "Payment approved and booking confirmed." : "Payment rejected. Slots released.");
    onVerified(due.ids, action);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <ReceiptText className="size-5 text-primary" />
            Verify GCash Payment
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Check the screenshot and reference against your GCash history before approving.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
          {duplicate && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs leading-relaxed">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>This reference was also used on another booking</p>
            </div>
          )}

          <div className="p-3 rounded-lg bg-muted/40 border border-border flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Player:</span>
              <span className="font-bold text-foreground">{booking.customer_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Court:</span>
              <span className="font-semibold text-primary">
                {courts > 1 ? `${courts} courts` : booking.courts?.name || `Court ${booking.court_id}`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Reference:</span>
              <span className="font-mono font-bold text-foreground">{reference || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Submitted:</span>
              <span className="text-foreground">{submittedAt}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-1.5 mt-0.5">
              <span className="font-semibold text-muted-foreground">Expected total:</span>
              <span className="font-extrabold text-sm text-foreground">₱{due.total.toLocaleString()}</span>
            </div>
          </div>

          {proofUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
            <img src={proofUrl} alt="GCash payment screenshot" className="max-h-80 w-full rounded-lg border border-border object-contain bg-muted/30" />
          ) : (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              {proofPath ? <Loader2 className="size-4 animate-spin" /> : "No screenshot"}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button variant="destructive" disabled={!!loading} onClick={() => decide("reject")} className="font-bold text-xs sm:text-sm">
            {loading === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject & release slots"}
          </Button>
          <Button disabled={!!loading} onClick={() => decide("approve")} className="font-bold text-xs sm:text-sm">
            {loading === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve — mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
