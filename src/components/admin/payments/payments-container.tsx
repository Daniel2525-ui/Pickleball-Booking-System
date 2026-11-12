"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import PaymentFilters from "./payment-filters";
import PaymentsTable from "./payments-table";
import { businessToday } from "@/lib/utils/bookingTime";
import { useDayEndsAt } from "@/hooks/use-day-ends-at";

export interface PaymentFiltersState {
  search: string;
  status: string;
  date: string;
}

export default function PaymentsContainer() {
  // The desk's day starts at the venue's cutoff, so the first view waits for it
  const dayEndsAt = useDayEndsAt();
  return dayEndsAt === null ? null : <Payments dayEndsAt={dayEndsAt} />;
}

function Payments({ dayEndsAt }: { dayEndsAt: string }) {
  // ?status= lets the dashboard alerts open this page pre-filtered, across every date; otherwise the desk closes out today
  const statusParam = useSearchParams().get("status");
  const [filters, setFilters] = useState<PaymentFiltersState>({
    search: "",
    status: statusParam || "All Statuses",
    date: statusParam ? "" : businessToday(dayEndsAt),
  });

  return (
    <div className="flex flex-col gap-6">
      <PaymentFilters
        filters={filters}
        onFilterChange={setFilters}
      />
      <PaymentsTable filters={filters} />
    </div>
  );
}

