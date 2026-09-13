"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, SlidersHorizontal } from "lucide-react";
import { useState, useEffect } from "react";
import { fetchCourts, CourtOption } from "@/lib/services/bookings/fetchCourtFilter.service";

interface BookingFiltersProps {
  onFilterChange?: (filters: { search: string; status: string; courtId: string }) => void;
}

export default function BookingFilters({ onFilterChange }: BookingFiltersProps = {}) {

  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("All Statuses")
  const [courtId, setCourtId] = useState("All Courts")
  const [courts, setCourts] = useState<CourtOption[]>([])

  useEffect(() => {
    const loadCourts = async () => {
      const { data } = await fetchCourts();

      setCourts(data)
    }

    loadCourts()
  }, [])

  const updateFilters = (newSearch: string, newStatus: string, newCourtId: string) => {
    onFilterChange?.({
      search: newSearch,
      status: newStatus,
      courtId: newCourtId
    })
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative w-full md:max-w-sm flex items-center justify-center">
          <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              setSearch(value);
              updateFilters(value, status, courtId)
            }}
            placeholder="Search by customer name or ID..."
            className="w-full pl-9 bg-background"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={status}
          onValueChange={(value) => {
            const newStatus = value || "All Statuses";
            setStatus(newStatus);
            updateFilters(search, newStatus, courtId)
          }}
          defaultValue="All Statuses">
          <SelectTrigger className="w-[140px] bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Statuses">All Statuses</SelectItem>
            <SelectItem value="Confirmed">Confirmed</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={courtId}
          onValueChange={(value) => {
            const newCourtId = value || "All Courts"
            setCourtId(newCourtId)
            updateFilters(search, status, newCourtId)
          }}
          defaultValue="All Courts">
          <SelectTrigger className="w-[140px] bg-background">
            <SelectValue placeholder="Court" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Courts">All Courts</SelectItem>
            {courts.map((court) =>
              <SelectItem key={court.id} value={court.name}>
                {court.name}
              </SelectItem>)}
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon" className="shrink-0 bg-background">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="sr-only">More filters</span>
        </Button>
      </div>
    </div>
  );
}
