"use client";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, CheckCircle2, XCircle, CalendarX, Loader2, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import { fetchBookings } from "@/lib/services/bookings/filterBookingsData.service";
import { Booking } from "@/lib/services/bookings/bookingsTypes";
import { formatTime12h } from "@/lib/utils/formatTime";
import { removeBooking } from "@/lib/services/bookings/removeBooking.service";
import { confirmBooking } from "@/lib/services/bookings/confirmBooking.service";

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-semibold",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-semibold",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20 font-semibold",
};

const getStatusColor = (status: string) => statusStyles[status?.toLowerCase()] ?? "bg-muted text-muted-foreground";

const capitalize = (status: string) => (status ? status[0].toUpperCase() + status.slice(1) : "");

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const columnCount = 6;

interface BookingsTableProps {
  filters?: {
    search: string;
    status: string;
    courtId: string;
    dateTime: string;
  };
  refreshKey?: number;
}

export default function BookingsTable({ filters, refreshKey = 0 }: BookingsTableProps = {}) {
  const [bookingsData, setBookingsData] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    const loadBookingsData = async () => {
      setLoading(true);
      const { data } = await fetchBookings(filters);
      if (data) setBookingsData(data);
      setLoading(false);
    };
    loadBookingsData();
  }, [filters, refreshKey]);

  const handleConfirmBooking = async (id: string) => {
    if (actionLoadingId) return;
    setActionLoadingId(id);

    const { data, error } = await confirmBooking(id);
    if (error || !data) {
      toast.error((error as Error)?.message || "Failed to confirm reservation.");
    } else {
      setBookingsData((prev) =>
        prev.map((booking) =>
          booking.id === id ? { ...booking, status: "confirmed" } : booking
        )
      );
      toast.success("Reservation confirmed successfully.");
    }

    setActionLoadingId(null);
  };

  const handleRemoveBooking = async (id: string) => {
    if (actionLoadingId) return;
    setActionLoadingId(id);
    const prevData = bookingsData;
    setBookingsData((prev) => prev.filter((booking) => booking.id !== id));

    const { error } = await removeBooking(id);
    if (error) {
      setBookingsData(prevData);
      toast.error("Failed to delete reservation.");
    } else {
      toast.success("Reservation deleted successfully.");
    }
    setActionLoadingId(null);
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
      <div className="max-h-[600px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10 border-b border-border shadow-2xs">
            <TableRow>
              <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Player / Booker</TableHead>
              <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Court</TableHead>
              <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Match Schedule</TableHead>
              <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Total Fee</TableHead>
              <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
              <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border/50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-8 w-8 ml-auto rounded-md" />
                  </TableCell>
                </TableRow>
              ))
            ) : bookingsData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2.5 p-6">
                    <div className="rounded-full bg-muted p-3 text-muted-foreground">
                      <CalendarX className="h-6 w-6" />
                    </div>
                    <div className="text-base font-bold text-foreground">No matching reservations found</div>
                    <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                      There are no court bookings matching your current filter criteria. Try adjusting the court selection or clearing the search.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              bookingsData.map((booking) => (
                <TableRow key={booking.id} className="group transition-colors hover:bg-muted/30">
                  <TableCell className="font-semibold text-foreground text-sm">
                    {booking.profiles?.full_name || "Guest Player"}
                  </TableCell>
                  <TableCell>
                    <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold text-xs">
                      {booking.courts?.name || `Court ${booking.court_id}`}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground text-xs sm:text-sm">
                        {formatDate(booking.booking_date)}
                      </span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        {formatTime12h(booking.start_time)} – {formatTime12h(booking.end_time)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-black text-foreground text-sm">
                    ₱{booking.total_amount ? booking.total_amount.toLocaleString() : "0"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${getStatusColor(booking.status)}`}>
                      {capitalize(booking.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-lg h-8 w-8 p-0 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        }
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            Actions
                          </DropdownMenuLabel>
                          {booking.status?.toLowerCase() === "pending" && (
                            <>
                              <DropdownMenuItem
                                onClick={() => handleConfirmBooking(booking.id)}
                                disabled={actionLoadingId === booking.id}
                                className="cursor-pointer text-emerald-600 focus:text-emerald-600 text-xs font-semibold"
                              >
                                {actionLoadingId === booking.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                Confirm Reservation
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem
                            onClick={() => handleRemoveBooking(booking.id)}
                            disabled={actionLoadingId === booking.id}
                            className="cursor-pointer text-destructive focus:text-destructive text-xs font-semibold"
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Delete Reservation
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}