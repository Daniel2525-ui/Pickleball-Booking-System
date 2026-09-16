"use client";

import { useState } from "react";
import BookingFilters from "./booking-filters";
import BookingsTable from "./bookings-table";

export interface BookingFiltersState {
  search: string;
  status: string;
  courtId: string;
}

export default function BookingsContainer() {
  const [filters, setFilters] = useState<BookingFiltersState>({
    search: "",
    status: "All Statuses",
    courtId: "All Courts",
  });

  return (
    <div className="flex flex-col gap-4">
      <BookingFilters onFilterChange={setFilters} />
      <BookingsTable filters={filters} />
    </div>
  );
}
