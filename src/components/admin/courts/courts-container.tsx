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
import { CourtBooking, fetchCourtsData, fetchTodayCourtBookings } from "@/lib/services/courts/courtsData.service";
import { courtNowNext } from "@/lib/services/courts/courtDay";
import { Court } from "@/lib/services/courts/courtsTypes";
import { AddCourtModal } from "./addCourtModal";
import { EditCourtModal } from "./editCourtModal";
import { deleteCourt } from "@/lib/services/courts/deleteCourt.service";
import { updateCourt } from "@/lib/services/courts/updateCourt.service";
import StatCard from "@/components/admin/dashboard/stat-card";
import { toast } from "sonner";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { AdminPageHeader } from "@/components/admin/page-header";

export default function CourtsContainer() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courts, setCourts] = useState<Court[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [courtToEdit, setCourtToEdit] = useState<Court | null>(null);
  // Set by a card's Maintenance / Closed button: the edit dialog opens on that status so staff see the bookings it affects
  const [editStatus, setEditStatus] = useState<string | null>(null);

  // Open applies at once (reopening clears the maintenance note); closing goes through the dialog
  const setCourtStatus = async (court: Court, next: "active" | "maintenance" | "closed") => {
    if (next !== "active") {
      setEditStatus(next);
      setCourtToEdit(court);
      return;
    }
    const { error } = await updateCourt(court.id, court.name, "active");
    if (error) toast.error(error.message);
    else {
      toast.success(`${court.name} is open for booking.`);
      loadCourts();
    }
  };
  const [todayBookings, setTodayBookings] = useState<CourtBooking[]>([]);

  const loadCourts = async () => {
    const [{ data }, today] = await Promise.all([fetchCourtsData(), fetchTodayCourtBookings()]);
    if (data) {
      setCourts(data);
    }
    setTodayBookings(today.data);
    setLoading(false);
  };

  const handleDelete = (court: Court) => {
    setConfirmRequest({
      title: `Delete ${court.name}?`,
      description:
        "This permanently removes the court. Courts that already have bookings can't be deleted; set them to maintenance instead.",
      confirmLabel: "Delete Court",
      onConfirm: () => removeCourt(court),
    });
  };

  const removeCourt = async (court: Court) => {
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
    let ignore = false;
    // Occupied and the now / next lines follow the clock while the page stays open
    const load = () =>
      Promise.all([fetchCourtsData(), fetchTodayCourtBookings()]).then(([{ data }, today]) => {
        if (ignore) return;
        if (data) setCourts(data);
        setTodayBookings(today.data);
        setLoading(false);
      });
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
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
      <AdminPageHeader title="Courts" description="Your courts, whether players can book them, and their photos. Changes show on the booking page right away.">
        <AddCourtModal onCourtAdded={loadCourts} />
      </AdminPageHeader>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total courts"
          value={loading ? "—" : counts.total}
          description="Courts at the venue"
          icon={MapPin}
        />
        <StatCard
          title="Available"
          value={loading ? "—" : counts.available}
          description="Players can book them"
          icon={CheckCircle2}
        />
        <StatCard
          title="In maintenance"
          value={loading ? "—" : counts.maintenance}
          description="Not bookable right now"
          icon={Wrench}
        />
        <StatCard
          title="In play"
          value={loading ? "—" : counts.occupied}
          description="A game on court now"
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
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors size-8 flex items-center justify-center rounded-lg"
                aria-label="Clear court search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "all")}>
            <SelectTrigger className="w-full sm:w-[180px] bg-background" aria-label="Filter courts by status">
              <SelectValue placeholder="Status">
                {(value) => ({ all: "All statuses", active: "Available", maintenance: "Maintenance", occupied: "Occupied" } as Record<string, string>)[value as string] ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
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
            No courts match your search or status filter. Try adjusting your search or filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((court) => (
            <CourtCard
              key={court.id}
              court={court}
              today={courtNowNext(todayBookings, court.id)}
              onEdit={(c) => {
                setEditStatus(null);
                setCourtToEdit(c);
              }}
              onSetStatus={setCourtStatus}
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
        initialStatus={editStatus}
      />

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}