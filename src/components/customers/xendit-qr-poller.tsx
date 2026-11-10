"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Waits for Xendit to report the QR paid, then hands over to the existing success page, which confirms the booking
export function XenditQrPoller({ prId, testMode }: { prId: string; testMode: boolean }) {
  const router = useRouter();
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/xendit/simulate?pr=${encodeURIComponent(prId)}`;

  useEffect(() => {
    const timer = setInterval(async () => {
      const data = await fetch(url).then((r) => r.json()).catch(() => null);
      if (data?.status === "SUCCEEDED") {
        clearInterval(timer);
        router.replace(`/book/success?session_id=${encodeURIComponent(prId)}`);
      }
    }, 2000);
    return () => clearInterval(timer);
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

  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />Waiting for payment…
      </p>
      {testMode && (
        <Button variant="outline" className="w-full h-11" onClick={simulate} disabled={simulating}>
          {simulating ? "Payment sent, confirming…" : "Simulate payment (test mode)"}
        </Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
