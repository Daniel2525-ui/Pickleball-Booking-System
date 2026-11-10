"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrPhImage } from "@/components/customers/qr-ph-image";
import { XenditQrPoller } from "@/components/customers/xendit-qr-poller";

/** Shows a QR Ph code for `amount` at the front desk and calls `onPaid` with its Xendit id once the customer has paid. */
export function CounterQr({ amount, disabled, onPaid }: { amount: number; disabled?: boolean; onPaid: (reference: string) => void }) {
  const [qr, setQr] = useState<{ prId: string; src: string; expiresAt: string; testMode: boolean } | null>(null);
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/payments/qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setLoading(false);
    if (!res?.ok || !body?.src) return setError(body?.error || "Could not create the QR Ph code. Try again.");
    setQr(body);
  };

  if (paid) {
    return (
      <p role="status" className="flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-4" />QR Ph payment of ₱{amount.toLocaleString()} received
      </p>
    );
  }

  if (!qr) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button type="button" variant="outline" className="w-full gap-2 font-bold" disabled={disabled || loading} onClick={show}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
          Show QR Ph code for ₱{amount.toLocaleString()}
        </Button>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-center">
      <p className="text-xs text-muted-foreground">Ask the customer to scan this with GCash, Maya or their bank app.</p>
      <QrPhImage src={qr.src} size={208} />
      <XenditQrPoller
        prId={qr.prId}
        expiresAt={qr.expiresAt}
        testMode={qr.testMode}
        onPaid={() => {
          setPaid(true);
          onPaid(qr.prId);
        }}
      />
    </div>
  );
}
