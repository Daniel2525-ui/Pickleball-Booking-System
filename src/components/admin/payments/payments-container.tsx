"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import PaymentFilters from "./payment-filters";
import PaymentsTable from "./payments-table";
import { businessToday } from "@/lib/utils/bookingTime";

export interface PaymentFiltersState {
  search: string;
  status: string;
  date: string;
}

export default function PaymentsContainer() {
  // ?status= lets the dashboard alerts open this page pre-filtered, across every date; otherwise the desk closes out today
  const statusParam = useSearchParams().get("status");
  const [filters, setFilters] = useState<PaymentFiltersState>({
    search: "",
    status: statusParam || "All Statuses",
    // shortcut: assumes the default 4 AM day cutoff for the first view, read booking_settings.day_ends_at if a venue changes it
    date: statusParam ? "" : businessToday(),
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

