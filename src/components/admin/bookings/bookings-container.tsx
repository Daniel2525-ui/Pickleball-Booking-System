"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatManilaDate } from "@/lib/utils/bookingTime";
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
  // ?status= lets the dashboard GCash alert open this page pre-filtered
  const params = useSearchParams();
  const statusParam = params.get("status");
  const initialStatus = statusParam || "All Statuses";
  const initialCourt = params.get("court") || "All Courts";
  const initialSearch = params.get("search") || "";
  // The desk works today's list; links from the dashboard (?status=), a court (?court=) or a customer (?search=) look across every date
  const initialDate = statusParam || params.get("court") || initialSearch ? "" : formatManilaDate();
  const [filters, setFilters] = useState<BookingFiltersState>({
    search: initialSearch,
    status: initialStatus,
    courtId: initialCourt,
    dateTime: initialDate,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <header className="sticky top-14 z-20 bg-background/95 backdrop-blur-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 pb-4 sm:pt-7 sm:pb-4 border-b border-border/60 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Court Reservations
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Monitor player reservations, manage slot confirmations, and record walk-in bookings.
          </p>
        </div>
        {/* A new filters object makes the table reload, so the recorded booking appears */}
        <AddBookingModal onBookingAdded={() => setFilters((current) => ({ ...current }))} />
      </header>

      <div className="flex flex-col gap-4">
        <BookingFilters initialStatus={initialStatus} initialDate={initialDate} initialCourt={initialCourt} initialSearch={initialSearch} onFilterChange={setFilters} />
        <BookingsTable filters={filters} />
      </div>
    </div>
  );
}
