"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { countRefundsOwed } from "@/lib/services/payments/paymentsData.service";

/** Shown only while paid payments sit on cancelled bookings. */
export default function RefundsOwedAlert() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    countRefundsOwed().then(setCount);
  }, []);

  if (count === 0) return null;

  return (
    <Link
      href={`/admin/payments?status=${encodeURIComponent("Refund Owed")}`}
      className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 hover:bg-amber-500/15 transition-colors"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">
          {count} {count === 1 ? "payment needs" : "payments need"} a refund
        </span>{" "}
        — paid bookings that were cancelled.
      </span>
      <span className="flex items-center gap-1 font-semibold">
        Review <ArrowRight className="size-3.5" />
      </span>
    </Link>
  );
}
