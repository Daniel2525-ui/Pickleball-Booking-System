"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { countRefundsOwed } from "@/lib/services/payments/paymentsData.service";
import { countAwaitingGcash } from "@/lib/services/bookings/filterBookingsData.service";

// Keyed by name because the dashboard is a server component and cannot pass functions down
const ALERTS = {
  refunds: {
    load: countRefundsOwed,
    href: `/admin/payments?status=${encodeURIComponent("Refund Owed")}`,
    label: (n: number) => `${n} ${n === 1 ? "payment needs" : "payments need"} a refund`,
    detail: "paid bookings that were cancelled.",
  },
  gcash: {
    load: countAwaitingGcash,
    href: `/admin/bookings?status=${encodeURIComponent("Awaiting Verification")}`,
    label: (n: number) => `${n} GCash ${n === 1 ? "payment" : "payments"} to verify`,
    detail: "customers sent a screenshot and are waiting for approval.",
  },
};

/** Shown only while something needs staff attention. */
export default function AttentionAlert({ kind }: { kind: keyof typeof ALERTS }) {
  const alert = ALERTS[kind];
  const [count, setCount] = useState(0);

  useEffect(() => {
    alert.load().then(setCount);
  }, [alert]);

  if (count === 0) return null;

  return (
    <Link
      href={alert.href}
      className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 hover:bg-amber-500/15 transition-colors"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">{alert.label(count)}</span> — {alert.detail}
      </span>
      <span className="flex items-center gap-1 font-semibold">
        Review <ArrowRight className="size-3.5" />
      </span>
    </Link>
  );
}
