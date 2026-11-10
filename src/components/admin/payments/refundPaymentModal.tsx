"use client";

import { useEffect, useState } from "react";
import { Loader2, Undo2, AlertCircle } from "lucide-react";
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
import { supabase } from "@/lib/supabase";
import { refundPayment } from "@/lib/services/payments/refundPayment.service";
import { Payment } from "@/lib/services/payments/paymentsTypes";

interface RefundPaymentModalProps {
  payment: Payment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefunded: (paymentId: string, status: string) => void;
}

export const RefundPaymentModal = ({ payment, open, onOpenChange, onRefunded }: RefundPaymentModalProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptReference, setReceiptReference] = useState("");
  const [proof, setProof] = useState<{ path: string; url: string | null } | null>(null);

  // Staff read the customer's GCash number off their payment screenshot to send the refund
  const proofPath = payment?.payment_method?.toLowerCase() === "gcash" ? payment.gcash_proof_path : null;
  // Keyed by path so a previous payment's screenshot never shows on this one
  const loaded = proof && proof.path === proofPath ? proof : null;
  const proofUrl = loaded?.url ?? null;
  const proofFailed = !!loaded && !loaded.url;
  useEffect(() => {
    if (!open || !proofPath) return;
    let stale = false;
    supabase.storage
      .from("gcash-receipts")
      .createSignedUrl(proofPath, 300)
      .then(({ data }) => {
        if (!stale) setProof({ path: proofPath, url: data?.signedUrl ?? null });
      });
    return () => {
      stale = true;
    };
  }, [open, proofPath]);

  if (!payment) return null;

  const method = (payment.payment_method || "stripe").toLowerCase();
  const isCash = method === "cash";
  // QR Ph payments keep the Xendit id staff look the payment up by
  const xenditId = isCash ? null : payment.payment_reference || payment.stripe_payment_id;
  const amount = Number(payment.amount) || 0;
  const customer = payment.bookings?.profiles?.full_name || payment.bookings?.customer_name || "Customer";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { status, error: refundErr } = await refundPayment(payment.id, receiptReference);

    setLoading(false);

    if (refundErr || !status) {
      setError(refundErr?.message || "Failed to refund payment.");
      return;
    }

    if (status === "refunded") {
      toast.success(`₱${amount.toLocaleString()} refunded to ${customer}`);
      onRefunded(payment.id, "refunded");
    } else {
      toast.info("Refund queued. It will complete automatically.");
    }
    setReceiptReference("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Undo2 className="size-5 text-primary" />
            Refund Payment
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            {isCash
              ? "Hand the cash back to the customer, then record the receipt number here."
              : `Send ₱${amount.toLocaleString()} back to the customer from the Xendit dashboard, then enter the refund reference here. This only records the refund.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div className="p-3 rounded-lg bg-muted/40 border border-border flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Player:</span>
              <span className="font-bold text-foreground">{customer}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Paid via:</span>
              <span className="font-semibold">{isCash ? "Cash" : "QR Ph"}</span>
            </div>
            {xenditId && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Xendit payment id:</span>
                <span className="font-mono text-foreground break-all text-right">{xenditId}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border/60 pt-1.5 mt-0.5">
              <span className="font-semibold text-muted-foreground">Refund Amount:</span>
              <span className="font-extrabold text-sm text-foreground">₱{amount.toLocaleString()}</span>
            </div>
          </div>

          {proofPath && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                Customer&apos;s GCash screenshot: send the refund to the number under &quot;From&quot;
              </span>
              {proofUrl ? (
                <a href={proofUrl} target="_blank" rel="noopener noreferrer" title="Open full size">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
                  <img src={proofUrl} alt="Customer's GCash payment screenshot" className="max-h-64 w-full rounded-lg border border-border object-contain bg-muted/30 cursor-zoom-in" />
                </a>
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                  {!proofPath ? "No screenshot" : proofFailed ? "Couldn't load screenshot" : <Loader2 className="size-4 animate-spin" />}
                </div>
              )}
            </div>
          )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="refund-reference" className="text-[11px] font-medium text-muted-foreground">
                {isCash ? "Receipt / Voucher Number" : "Xendit refund reference"}
              </Label>
              <Input
                id="refund-reference"
                type="text"
                required
                value={receiptReference}
                onChange={(e) => setReceiptReference(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

          <DialogFooter className="mt-4 pt-2 border-t">
            <Button type="submit" disabled={loading} className="w-full sm:w-auto font-bold text-xs sm:text-sm gap-2">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refunding...
                </>
              ) : (
                `Refund ₱${amount.toLocaleString()}`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
