"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { countRefundsOwed, countToCollect } from "@/lib/services/payments/paymentsData.service";
import { useLiveRefresh } from "@/hooks/use-live-refresh";

// Keyed by name because the dashboard is a server component and cannot pass functions down
const ALERTS = {
  refunds: {
    load: countRefundsOwed,
    href: `/admin/payments?status=${encodeURIComponent("Refund Owed")}`,
    label: (n: number) => `${n} ${n === 1 ? "payment needs" : "payments need"} a refund`,
    detail: "Paid bookings that were cancelled.",
  },
  collect: {
    load: countToCollect,
    href: `/admin/payments?status=${encodeURIComponent("To Collect")}`,
    label: (n: number) => `${n} ${n === 1 ? "booking" : "bookings"} to collect`,
    detail: "Unpaid walk-ins and desk bookings.",
  },
};

/** Shown only while something needs staff attention. */
export default function AttentionAlert({ kind }: { kind: keyof typeof ALERTS }) {
  const alert = ALERTS[kind];
  const [count, setCount] = useState(0);

  useEffect(() => {
    alert.load().then(setCount);
  }, [alert]);
  useLiveRefresh(() => alert.load().then(setCount));

  if (count === 0) return null;

  return (
    <Link
      href={alert.href}
      className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-950 hover:bg-amber-100 transition-colors"
    >
      <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
      <span className="flex-1">
        <span className="font-semibold block">{alert.label(count)}</span>
        <span className="text-amber-900/90">{alert.detail}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 mt-0.5" aria-hidden />
    </Link>
  );
}
