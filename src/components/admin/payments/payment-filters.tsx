"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Filters = { search: string; status: string; date: string };

interface PaymentFiltersProps {
  filters?: Filters;
  onFilterChange: (filters: Filters) => void;
}

export default function PaymentFilters({
  filters = { search: "", status: "All Statuses", date: "" },
  onFilterChange,
}: PaymentFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, reference, GCash ref or phone"
          aria-label="Search payment transactions"
          value={filters.search}
          className="pl-9 bg-card border-border shadow-2xs"
          onChange={(e) =>
            onFilterChange({ ...filters, search: e.target.value })
          }
        />
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto">
        <div className="flex flex-1 sm:flex-none items-center gap-1">
          <Input
            type="date"
            aria-label="Filter by payment date"
            value={filters.date}
            onChange={(e) => onFilterChange({ ...filters, date: e.target.value })}
            className="w-full sm:w-[150px] bg-card border-border shadow-2xs"
          />
          {filters.date && (
            <button
              type="button"
              onClick={() => onFilterChange({ ...filters, date: "" })}
              className="size-8 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Clear date filter"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Select
          value={filters.status || "All Statuses"}
          onValueChange={(value) =>
            onFilterChange({ ...filters, status: value ?? "All Statuses" })
          }
        >
          <SelectTrigger
            aria-label="Filter by payment status"
            className="w-full sm:w-[190px] bg-card border-border shadow-2xs"
          >
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Statuses">All Statuses</SelectItem>
            <SelectItem value="Succeeded">Succeeded (Paid)</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Refunded">Refunded</SelectItem>
            <SelectItem value="Refund Owed">Refund Owed</SelectItem>
            <SelectItem value="To Collect">To Collect</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

