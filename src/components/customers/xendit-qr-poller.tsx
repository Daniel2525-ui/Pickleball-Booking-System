"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Waits for Xendit to report the QR paid, then hands over to the existing success page, which confirms the booking
/** `onPaid` (front desk) replaces the hand-over to the success page. */
export function XenditQrPoller({ prId, expiresAt, testMode, onPaid }: { prId: string; expiresAt: string; testMode: boolean; onPaid?: () => void }) {
  const router = useRouter();
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const url = `/api/xendit/simulate?pr=${encodeURIComponent(prId)}`;

  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    // Two slow status checks can both come back paid; the payment must be handed over once
    let done = false;
    const timer = setInterval(async () => {
      const data = await fetch(url).then((r) => r.json()).catch(() => null);
      if (data?.status === "SUCCEEDED" && !done) {
        done = true;
        clearInterval(timer);
        if (onPaid) onPaid();
        else router.replace(`/book/success?session_id=${encodeURIComponent(prId)}`);
      }
      // The server page shows the expired message once Xendit has closed the QR
      if (data?.status === "EXPIRED" && !onPaid) router.refresh();
    }, 2000);
    return () => clearInterval(timer);
    // onPaid is left out: a new function each render would restart the polling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, prId, router]);

  const simulate = async () => {
    setSimulating(true);
    setError(null);
    const res = await fetch(url, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setError("Simulated payment failed. Try again.");
      setSimulating(false);
    }
  };

  const expired = secondsLeft === 0;
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        {expired ? "This QR code has expired." : <><LoaderCircle className="size-4 animate-spin" />Waiting for payment…</>}
      </p>
      {secondsLeft !== null && !expired && (
        <p className="text-sm font-semibold tabular-nums" aria-label="Time left to pay">
          Pay within {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </p>
      )}
      {testMode && !expired && (
        <Button variant="outline" className="w-full h-11" onClick={simulate} disabled={simulating}>
          {simulating ? "Payment sent, confirming…" : "Simulate payment (test mode)"}
        </Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
