"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import PaymentFilters from "./payment-filters";
import PaymentsTable from "./payments-table";

export interface PaymentFiltersState {
  search: string;
  status: string;
}

export default function PaymentsContainer() {
  // ?status= lets the dashboard refund alert open this page pre-filtered
  const initialStatus = useSearchParams().get("status") || "All Statuses";
  const [filters, setFilters] = useState<PaymentFiltersState>({
    search: "",
    status: initialStatus,
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

