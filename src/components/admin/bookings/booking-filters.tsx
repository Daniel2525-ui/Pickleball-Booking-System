"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { useState, useEffect } from "react";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { countAwaitingGcash } from "@/lib/services/bookings/filterBookingsData.service";
import { CourtOption } from "@/lib/services/bookings/bookingsTypes";

interface BookingFiltersProps {
  initialStatus?: string;
  initialDate?: string;
  initialCourt?: string;
  initialSearch?: string;
  onFilterChange?: (filters: {
    search: string;
    status: string;
    courtId: string;
    dateTime: string;
  }) => void;
}

export default function BookingFilters({ initialStatus = "All Statuses", initialDate = "", initialCourt = "All Courts", initialSearch = "", onFilterChange }: BookingFiltersProps = {}) {
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [courtId, setCourtId] = useState(initialCourt);
  const [dateTime, setDateTime] = useState(initialDate);
  const [courts, setCourts] = useState<CourtOption[]>([]);
  const [awaiting, setAwaiting] = useState(0);

  useEffect(() => {
    const loadCourts = async () => {
      const { data } = await fetchCourtsData();
      setCourts(data);
    };

    loadCourts();
    countAwaitingGcash().then(setAwaiting);
  }, []);

  const updateFilters = (
    newSearch: string,
    newStatus: string,
    newCourtId: string,
    newDateTime: string
  ) => {
    onFilterChange?.({
      search: newSearch,
      status: newStatus,
      courtId: newCourtId,
      dateTime: newDateTime,
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative w-full sm:max-w-sm flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              setSearch(value);
              updateFilters(value, status, courtId, dateTime);
            }}
            placeholder="Search by name or reference number"
            className="w-full pl-9 bg-background h-9 text-xs sm:text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
        <Select
          value={status}
          onValueChange={(value) => {
            const newStatus = value || "All Statuses";
            setStatus(newStatus);
            updateFilters(search, newStatus, courtId, dateTime);
          }}
          defaultValue="All Statuses"
        >
          <SelectTrigger className="flex-1 sm:w-[140px] bg-background h-10 text-xs sm:text-sm font-medium">
            <SelectValue placeholder="Status Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Statuses">All Statuses</SelectItem>
            <SelectItem value="Confirmed">Confirmed</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Awaiting Verification">
              Awaiting Verification{awaiting > 0 ? ` (${awaiting})` : ""}
            </SelectItem>
            <SelectItem value="Checked In">Checked In</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
            <SelectItem value="No-Show">No-Show</SelectItem>
            <SelectItem value="Cancelled">Cancelled</SelectItem>
            <SelectItem value="Expired">Expired Holds</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1 sm:flex-none flex items-center gap-1">
          <Input
            type="date"
            aria-label="Filter by booking date"
            value={dateTime}
            onChange={(e) => {
              setDateTime(e.target.value);
              updateFilters(search, status, courtId, e.target.value);
            }}
            className="w-full sm:w-[150px] bg-background h-10 text-xs sm:text-sm"
          />
          {dateTime && (
            <button
              type="button"
              onClick={() => {
                setDateTime("");
                updateFilters(search, status, courtId, "");
              }}
              className="size-8 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Clear date filter"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Select
          value={courtId}
          onValueChange={(value) => {
            const newCourtId = value || "All Courts";
            setCourtId(newCourtId);
            updateFilters(search, status, newCourtId, dateTime);
          }}
          defaultValue="All Courts"
        >
          <SelectTrigger className="flex-1 sm:w-[140px] bg-background h-10 text-xs sm:text-sm font-medium">
            <SelectValue placeholder="Court Filter">
              {(value) => {
                if (!value || value === "All Courts") return "All Courts";
                const court = courts.find((court) => court.id === value || court.name === value);
                return court ? court.name : value;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Courts">All Courts</SelectItem>
            {courts.map((court) => (
              <SelectItem key={court.id} value={court.id}>
                {court.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
