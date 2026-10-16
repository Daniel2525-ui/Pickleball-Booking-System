"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaymentFiltersProps {
  filters?: { search: string; status: string };
  onFilterChange: (filters: { search: string; status: string }) => void;
}

export default function PaymentFilters({
  filters = { search: "", status: "All Statuses" },
  onFilterChange,
}: PaymentFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by customer or court name..."
          aria-label="Search payment transactions"
          value={filters.search}
          className="pl-9 bg-card border-border shadow-2xs"
          onChange={(e) =>
            onFilterChange({
              search: e.target.value,
              status: filters.status || "All Statuses",
            })
          }
        />
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={filters.status || "All Statuses"}
          onValueChange={(value) =>
            onFilterChange({
              search: filters.search,
              status: value ?? "All Statuses",
            })
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
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

