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
import { bookingTitle } from "@/lib/services/openPlay/bookingTitle";

interface VerifyGcashModalProps {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (bookingIds: string[], action: "approve" | "reject") => void;
}

export const VerifyGcashModal = ({ booking, open, onOpenChange, onVerified }: VerifyGcashModalProps) => {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [proofFailed, setProofFailed] = useState(false);
  // The whole submitted basket, not just the rows the table happens to have loaded
  const [basket, setBasket] = useState<{ id: string; total_amount: number | null; courts: { name?: string } | null; open_play_spots: number | null }[] | null>(null);

  const payment = booking ? (Array.isArray(booking.payments) ? booking.payments[0] : booking.payments) : null;
  const paymentId = payment?.id;
  const reference = payment?.payment_reference;
  const proofPath = payment?.gcash_proof_path;
  const basketId = booking?.basket_id;

  useEffect(() => {
    if (!open || !paymentId) return;
    let stale = false;
    if (proofPath) {
      supabase.storage
        .from("gcash-receipts")
        .createSignedUrl(proofPath, 300)
        .then(({ data }) => {
          if (stale) return;
          setProofUrl(data?.signedUrl ?? null);
          setProofFailed(!data?.signedUrl);
        });
    }
    if (basketId) {
      supabase
        .from("bookings")
        .select("id, total_amount, open_play_spots, courts(name)")
        .eq("basket_id", basketId)
        .eq("status", "pending")
        .eq("hold_expires_at", "infinity")
        .then(({ data, error: loadErr }) => {
          if (stale) return;
          if (loadErr) setError("Couldn't load this booking's courts. Close and try again.");
          else setBasket((data ?? []) as unknown as NonNullable<typeof basket>);
        });
    }
    // submit_gcash_proof copies the reference onto every court of the basket, so exclude the whole basket
    // (walk-in and legacy rows have no basket_id, and a plain neq would drop them)
    if (reference && basketId) {
      supabase
        .from("payments")
        .select("id, bookings!inner(basket_id)", { count: "exact", head: true })
        .eq("payment_reference", reference)
        .eq("payment_method", "gcash")
        .or(`basket_id.is.null,basket_id.neq.${basketId}`, { referencedTable: "bookings" })
        .then(({ count }) => !stale && setDuplicate((count ?? 0) > 0));
    }
    return () => {
      stale = true;
    };
  }, [open, paymentId, proofPath, reference, basketId]);

  if (!booking) return null;

  const ids = basket?.map((b) => b.id) ?? [];
  const total = basket?.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0) ?? 0;
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
    onVerified(ids, action);
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
                {!basket ? "—" : ids.length > 1 ? `${ids.length} courts` : bookingTitle(basket[0] ?? booking)}
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
              <span className="font-extrabold text-sm text-foreground">{basket ? `₱${total.toLocaleString()}` : "—"}</span>
            </div>
          </div>

          {proofUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
            <img src={proofUrl} alt="GCash payment screenshot" className="max-h-80 w-full rounded-lg border border-border object-contain bg-muted/30" />
          ) : (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              {!proofPath ? "No screenshot" : proofFailed ? "Couldn't load screenshot" : <Loader2 className="size-4 animate-spin" />}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button variant="destructive" disabled={!!loading || !basket?.length} onClick={() => decide("reject")} className="font-bold text-xs sm:text-sm">
            {loading === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject & release slots"}
          </Button>
          <Button disabled={!!loading || !basket?.length} onClick={() => decide("approve")} className="font-bold text-xs sm:text-sm">
            {loading === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve — mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
