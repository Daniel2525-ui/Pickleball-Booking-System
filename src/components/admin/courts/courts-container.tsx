"use client";

import { useState, useEffect } from "react";
import { Search, X, MapPin, CheckCircle2, Wrench, Activity, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import StatCard from "@/components/admin/dashboard/stat-card";
import { toast } from "sonner";

export default function CourtsContainer() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
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

  const handleDelete = async (court: Court) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${court.name}"? Existing bookings for this court may be affected.`
    );
    if (!confirmed) return;

    const { error } = await deleteCourt(court.id);
    if (error) {
      const message = (error as Error)?.message || "Failed to delete court. Please try again.";
      toast.error(message);
      return;
    }

    toast.success(`Court "${court.name}" deleted successfully.`);
    loadCourts();
  };

  useEffect(() => {
    loadCourts();
  }, []);

  const normalizedSearch = search.trim().toLowerCase();

  const filtered = courts.filter((court) => {
    const matchesSearch =
      !normalizedSearch || court.name?.toLowerCase().includes(normalizedSearch);

    const courtStatus = court.status?.toLowerCase();
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && (courtStatus === "active" || courtStatus === "available")) ||
      courtStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const counts = {
    total: courts.length,
    available: courts.filter((c) => c.status === "active" || c.status === "available").length,
    maintenance: courts.filter((c) => c.status === "maintenance").length,
    occupied: courts.filter((c) => c.status === "occupied").length,
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Courts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your pickleball courts, operating status, and availability.
          </p>
        </div>
        <AddCourtModal onCourtAdded={loadCourts} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Courts"
          value={loading ? "—" : counts.total}
          description="Total venue courts registered"
          icon={MapPin}
        />
        <StatCard
          title="Available"
          value={loading ? "—" : counts.available}
          description="Open for player reservations"
          icon={CheckCircle2}
        />
        <StatCard
          title="In Maintenance"
          value={loading ? "—" : counts.maintenance}
          description="Temporarily offline for repairs"
          icon={Wrench}
        />
        <StatCard
          title="Occupied"
          value={loading ? "—" : counts.occupied}
          description="Active reservation in progress"
          icon={Activity}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="relative flex-1 max-w-md w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search courts by name..."
              aria-label="Search courts by name"
              className="pl-9 pr-8 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded-sm"
                aria-label="Clear court search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "all")}>
            <SelectTrigger className="w-full sm:w-[180px] bg-background" aria-label="Filter courts by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Available</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="occupied">Occupied</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(search || statusFilter !== "all") && (
          <div className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {courts.length}{" "}
            {courts.length === 1 ? "court" : "courts"}
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden p-6 pb-4">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-40 mt-3" />
            </div>
          ))}
        </div>
      ) : courts.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center space-y-3 rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
          <div className="rounded-full bg-muted p-3">
            <MapPin className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-base font-semibold">No courts added yet</div>
          <p className="text-sm text-muted-foreground max-w-sm">
            You haven&apos;t added any courts to your facility. Add a court to start accepting player reservations.
          </p>
          <AddCourtModal
            onCourtAdded={loadCourts}
            trigger={
              <Button className="mt-2">
                Add Your First Court
              </Button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center space-y-3 rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
          <div className="rounded-full bg-muted p-3">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-base font-semibold">No matching courts found</div>
          <p className="text-sm text-muted-foreground max-w-sm">
            No courts match your search or status filter. Try adjusting or resetting your filters.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
            className="mt-2"
          >
            Reset filters
          </Button>
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