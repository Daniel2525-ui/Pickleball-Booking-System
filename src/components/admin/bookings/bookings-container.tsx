"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { businessToday } from "@/lib/utils/bookingTime";
import { useDayEndsAt } from "@/hooks/use-day-ends-at";
import BookingFilters from "./booking-filters";
import BookingsTable from "./bookings-table";
import { AddBookingModal } from "./addBookingModal";
import { AdminPageHeader } from "@/components/admin/page-header";

export interface BookingFiltersState {
  search: string;
  status: string;
  courtId: string;
  dateTime: string;
}

export default function BookingsContainer() {
  // The list starts on today's business day and check-in follows it, so both wait for the venue's cutoff
  const dayEndsAt = useDayEndsAt();
  return dayEndsAt === null ? null : <Reservations dayEndsAt={dayEndsAt} />;
}

function Reservations({ dayEndsAt }: { dayEndsAt: string }) {
  // ?status= lets a dashboard alert open this page pre-filtered
  const params = useSearchParams();
  const statusParam = params.get("status");
  const initialStatus = statusParam || "All Statuses";
  const initialCourt = params.get("court") || "All Courts";
  const initialSearch = params.get("search") || "";
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : "";
  // The desk works today's list; links from the dashboard (?status=), a court (?court=) or a customer (?search=) look across
  // every date, and ?date= opens one day
  const initialDate = dateParam || (statusParam || params.get("court") || initialSearch ? "" : businessToday(dayEndsAt));
  const [filters, setFilters] = useState<BookingFiltersState>({
    search: initialSearch,
    status: initialStatus,
    courtId: initialCourt,
    dateTime: initialDate,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <AdminPageHeader title="Bookings" description="Every court booking: check players in, collect payments, move or cancel.">
        {/* A new filters object makes the table reload, so the recorded booking appears. ?new=walkin (dashboard) opens it */}
        <AddBookingModal defaultOpen={params.get("new") === "walkin"} onBookingAdded={() => setFilters((current) => ({ ...current }))} />
      </AdminPageHeader>

      <div className="flex flex-col gap-4">
        <BookingFilters initialStatus={initialStatus} initialDate={initialDate} initialCourt={initialCourt} initialSearch={initialSearch} onFilterChange={setFilters} />
        <BookingsTable filters={filters} dayEndsAt={dayEndsAt} />
      </div>
    </div>
  );
}
