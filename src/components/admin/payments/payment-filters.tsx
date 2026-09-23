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
  onFilterChange: (filters: { search: string; status: string }) => void;
}

export default function PaymentFilters({ onFilterChange }: PaymentFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by customer name..."
          className="pl-9 bg-background"
          onChange={(e) =>
            onFilterChange({
              search: e.target.value,
              status: "",
            })
          }
        />
      </div>
      <Select
        defaultValue="All Statuses"
        onValueChange={(value) =>
          onFilterChange({
            search: "",
            status: value ?? "",
          })
        }
      >
        <SelectTrigger className="w-full sm:w-[180px] bg-background">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All Statuses">All Statuses</SelectItem>
          <SelectItem value="Succeeded">Succeeded</SelectItem>
          <SelectItem value="Pending">Pending</SelectItem>
          <SelectItem value="Failed">Failed</SelectItem>
          <SelectItem value="Refunded">Refunded</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
