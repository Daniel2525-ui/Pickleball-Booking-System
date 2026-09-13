"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, FileText, CheckCircle2, XCircle, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchBookings, Booking } from "@/lib/services/bookings/bookingsData.service";

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "confirmed":
      return "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/50";
    case "pending":
      return "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-amber-200 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/50";
    case "cancelled":
      return "bg-red-500/15 text-red-700 hover:bg-red-500/25 border-red-200 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/50";
    default:
      return "";
  }
};

interface BookingsTableProps {
  filters?: {
    search: string;
    status: string;
    courtId: string;
  };
}

export default function BookingsTable({ filters }: BookingsTableProps = {}) {
  const [bookingsData, setBookingsData] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadBookingsData = async () => {
      setLoading(true);

      const { data } = await fetchBookings(filters);

      if (data) {
        setBookingsData(data);
      }
      setLoading(false);
    };
    loadBookingsData();
  }, [filters]);


  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Booking ID</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Court</TableHead>
            <TableHead>Date & Time</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="h-32 text-center">
                <div className="flex flex-col items-center justify-center space-y-2 text-muted-foreground">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-sm">Fetching Bookings Data...</span>
                </div>
              </TableCell>
            </TableRow>
          ) : bookingsData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                No bookings found.
              </TableCell>
            </TableRow>
          ) : (
            bookingsData.map((booking) => (
              <TableRow key={booking.id} className="group transition-colors hover:bg-muted/50">
                <TableCell className="font-medium text-xs text-muted-foreground">
                  {booking.id.split('-')[0]} {/* Example: shorten UUID if needed, otherwise leave as booking.id */}
                </TableCell>
                <TableCell>
                  <span className="font-medium">{booking.profiles?.full_name || "Unknown"}</span>
                </TableCell>
                <TableCell>{booking.courts?.name || "Unknown"}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>
                      {new Date(booking.booking_date).toLocaleDateString("en-CA", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {booking.start_time} - {booking.end_time}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  ₱{booking.total_amount?.toLocaleString() || 0}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={getStatusColor(booking.status)}>
                    {booking.status ? booking.status.charAt(0).toUpperCase() + booking.status.slice(1) : ""}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem className="cursor-pointer">
                        <FileText className="mr-2 h-4 w-4" />
                        View details
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {booking.status?.toLowerCase() === "pending" && (
                        <DropdownMenuItem className="cursor-pointer text-emerald-600 focus:text-emerald-600">
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Confirm Booking
                        </DropdownMenuItem>
                      )}
                      {booking.status?.toLowerCase() !== "cancelled" && (
                        <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive">
                          <XCircle className="mr-2 h-4 w-4" />
                          Cancel Booking
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
