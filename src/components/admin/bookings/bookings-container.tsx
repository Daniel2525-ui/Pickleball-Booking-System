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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
              <h1 className="text-3xl font-bold tracking-tight">Bookings</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                  Manage all your pickleball court reservations.
              </p>
          </div>
          <AddBookingModal onBookingAdded={() => setRefreshKey(prev => prev + 1)} />
      </div>

      <div className="flex flex-col gap-4">
        <BookingFilters onFilterChange={setFilters} />
        <BookingsTable filters={filters} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
