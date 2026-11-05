"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Booking } from "@/lib/services/bookings/bookingsTypes";

/** Cancelling a paid booking: staff decide case by case whether the payment is refunded or kept. */
export const CancelPaidModal = ({
  booking,
  onClose,
  onConfirm,
}: {
  booking: Booking | null;
  onClose: () => void;
  onConfirm: (booking: Booking, keep: { note: string } | undefined) => Promise<boolean>;
}) => {
  const [choice, setChoice] = useState<"refund" | "keep">("refund");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prev, setPrev] = useState<Booking | null>(null);

  if (booking !== prev) {
    setPrev(booking);
    setChoice("refund");
    setNote("");
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking) return;
    if (choice === "keep" && !note.trim()) return setError("Write a short reason for keeping the payment.");
    setSaving(true);
    const ok = await onConfirm(booking, choice === "keep" ? { note: note.trim() } : undefined);
    setSaving(false);
    if (ok) onClose();
  };

  const option = (value: "refund" | "keep", title: string, hint: string) => (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${choice === value ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <input
        type="radio"
        name="cancel-choice"
        value={value}
        checked={choice === value}
        onChange={() => {
          setChoice(value);
          setError(null);
        }}
        className="mt-1"
      />
      <span>
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this paid reservation?</DialogTitle>
          <DialogDescription>
            {booking?.customer_name || "This player"}&apos;s court slot will be released. Choose what happens to the payment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3 py-1">
          {option("refund", "Cancel and refund", "The payment goes to Refund Owed on the Payments page.")}
          {option("keep", "Cancel and keep the payment", "No refund is owed, for example a late cancellation.")}
          {choice === "keep" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="cancel-note">Reason for keeping the payment</Label>
              <textarea
                id="cancel-note"
                maxLength={200}
                rows={2}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Late cancellation, no refund"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="mt-2 gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Go Back
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel Reservation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
