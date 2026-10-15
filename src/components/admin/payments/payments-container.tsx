"use client";

import { useState } from "react";
import PaymentFilters from "./payment-filters";
import PaymentsTable from "./payments-table";

export interface PaymentFiltersState {
  search: string;
  status: string;
}

export default function PaymentsContainer() {
  const [filters, setFilters] = useState<PaymentFiltersState>({
    search: "",
    status: "All Statuses",
  });

  const handleResetFilters = () => {
    setFilters({
      search: "",
      status: "All Statuses",
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PaymentFilters
        filters={filters}
        onFilterChange={setFilters}
      />
      <PaymentsTable filters={filters} onResetFilters={handleResetFilters} />
    </div>
  );
}

