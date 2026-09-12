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
import { useState } from "react";

export default function BookingFilters() {

  const [search, setSearch] = useState("")
  const [bookingsData, setBookingsData] = useState([])

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative w-full md:max-w-sm flex items-center justify-center">
          <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name or ID..."
            className="w-full pl-9 bg-background"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select defaultValue="All Statuses">
          <SelectTrigger className="w-[140px] bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Statuses">All Statuses</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select defaultValue="All Courts">
          <SelectTrigger className="w-[140px] bg-background">
            <SelectValue placeholder="Court" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Courts">All Courts</SelectItem>
            <SelectItem value="Court 1">Court 1</SelectItem>
            <SelectItem value="Court 2">Court 2</SelectItem>
            <SelectItem value="Court 3">Court 3</SelectItem>
            <SelectItem value="Court 4">Court 4</SelectItem>
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
