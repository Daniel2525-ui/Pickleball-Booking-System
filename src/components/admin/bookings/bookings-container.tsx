"use client";

import { useState } from "react";
import BookingFilters from "./booking-filters";
import BookingsTable from "./bookings-table";
import { AddBookingModal } from "./addBookingModal";

export interface BookingFiltersState {
  search: string;
  status: string;
  courtId: string;
  dateTime: string;
}

export default function BookingsContainer() {
  const [filters, setFilters] = useState<BookingFiltersState>({
    search: "",
    status: "All Statuses",
    courtId: "All Courts",
    dateTime: "",
  });

  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Court Reservations
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Monitor player reservations, manage slot confirmations, and record walk-in bookings.
          </p>
        </div>
        <AddBookingModal onBookingAdded={() => setRefreshKey((prev) => prev + 1)} />
      </div>

      <div className="flex flex-col gap-4">
        <BookingFilters onFilterChange={setFilters} />
        <BookingsTable filters={filters} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
