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
import { MoreHorizontal, FileText, CheckCircle2, XCircle } from "lucide-react";

// Mock Data
const mockBookings = [
  {
    id: "BKG-1029",
    customer: "Alex Johnson",
    email: "alex.j@example.com",
    court: "Court 1",
    date: "Oct 24, 2026",
    time: "10:00 AM - 11:30 AM",
    amount: "₱750",
    status: "Confirmed",
  },
  {
    id: "BKG-1030",
    customer: "Sarah Williams",
    email: "swilliams@example.com",
    court: "Court 2",
    date: "Oct 24, 2026",
    time: "11:00 AM - 1:00 PM",
    amount: "₱1,000",
    status: "Pending",
  },
  {
    id: "BKG-1031",
    customer: "Michael Brown",
    email: "mbrown88@example.com",
    court: "Court 3",
    date: "Oct 24, 2026",
    time: "2:00 PM - 3:30 PM",
    amount: "₱750",
    status: "Confirmed",
  },
  {
    id: "BKG-1032",
    customer: "Emily Davis",
    email: "emily.d@example.com",
    court: "Court 1",
    date: "Oct 25, 2026",
    time: "9:00 AM - 11:00 AM",
    amount: "₱1,000",
    status: "Cancelled",
  },
  {
    id: "BKG-1033",
    customer: "David Wilson",
    email: "dwilson_pro@example.com",
    court: "Court 4",
    date: "Oct 25, 2026",
    time: "4:00 PM - 6:00 PM",
    amount: "₱1,000",
    status: "Confirmed",
  },
  {
    id: "BKG-1034",
    customer: "Jessica Taylor",
    email: "jtaylor99@example.com",
    court: "Court 2",
    date: "Oct 26, 2026",
    time: "8:00 AM - 9:30 AM",
    amount: "₱750",
    status: "Pending",
  },
];

const getStatusBadgeVariant = (status: string) => {
  switch (status.toLowerCase()) {
    case "confirmed":
      return "default"; // or custom emerald class if needed, but default is usually primary
    case "pending":
      return "secondary"; // amber-ish
    case "cancelled":
      return "destructive"; // red
    default:
      return "outline";
  }
};

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

export default function BookingsTable() {
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
          {mockBookings.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center">
                No bookings found.
              </TableCell>
            </TableRow>
          ) : (
            mockBookings.map((booking) => (
              <TableRow key={booking.id}>
                <TableCell className="font-medium">{booking.id}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{booking.customer}</span>
                    <span className="text-xs text-muted-foreground">
                      {booking.email}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{booking.court}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{booking.date}</span>
                    <span className="text-xs text-muted-foreground">
                      {booking.time}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{booking.amount}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={getStatusColor(booking.status)}
                  >
                    {booking.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <Button variant="ghost" className="h-8 w-8 p-0">
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
                      {booking.status === "Pending" && (
                        <DropdownMenuItem className="cursor-pointer text-emerald-600 focus:text-emerald-600">
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Confirm Booking
                        </DropdownMenuItem>
                      )}
                      {booking.status !== "Cancelled" && (
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
