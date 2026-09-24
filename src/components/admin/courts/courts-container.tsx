"use client";

import { useState, useEffect } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CourtCard } from "./court-card";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { Court } from "@/lib/services/courts/courtsTypes";
import { AddCourtModal } from "./addCourtModal";
import { EditCourtModal } from "./editCourtModal";
import { deleteCourt } from "@/lib/services/courts/deleteCourt.service";

export default function CourtsContainer() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Courts");
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [courtToEdit, setCourtToEdit] = useState<Court | null>(null);

  const loadCourts = async () => {
    setLoading(true);
    const { data } = await fetchCourtsData();
    if (data) {
      setCourts(data);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this court?")) return;
    
    const { error } = await deleteCourt(id);
    if (error) {
        alert("Failed to delete court");
        return;
    }
    
    loadCourts();
  };

  useEffect(() => {
    loadCourts();
  }, []);

  const filtered = courts.filter((court) => {
    const matchesSearch =
      !search || court.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All Courts" || court.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const counts = {
    total: courts.length,
    available: courts.filter((c) => c.status === "available").length,
    maintenance: courts.filter((c) => c.status === "maintenance").length,
    occupied: courts.filter((c) => c.status === "occupied").length,
  };

  const stats = [{ label: "Total Courts", value: counts.total, color: "text-foreground" },
  { label: "Available", value: counts.available, color: "text-emerald-600 dark:text-emerald-400" },
  { label: "In Maintenance", value: counts.maintenance, color: "text-amber-600 dark:text-amber-400" },
  { label: "Occupied", value: counts.occupied, color: "text-red-600 dark:text-red-400" },]

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Courts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your pickleball courts, pricing, and availability.
          </p>
        </div>
        <AddCourtModal onCourtAdded={loadCourts} />
      </div>

      {/* Summary Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card px-4 py-3 shadow-sm">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search courts by name..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "All Courts")}>
          <SelectTrigger className="w-full sm:w-[160px] bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All Courts">All Courts</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="occupied">Occupied</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground text-sm">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Fetching courts...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm">
          No courts matched your search.
        </div>
      ) : courts.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm">
          No courts added yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((court) => (
            <CourtCard 
              key={court.id} 
              court={court} 
              onEdit={(c) => setCourtToEdit(c)} 
              onDelete={handleDelete} 
            />
          ))}
        </div>
      )}
      
      <EditCourtModal 
        court={courtToEdit} 
        open={!!courtToEdit} 
        onOpenChange={(open) => !open && setCourtToEdit(null)} 
        onCourtUpdated={loadCourts} 
      />
    </div>
  );
}