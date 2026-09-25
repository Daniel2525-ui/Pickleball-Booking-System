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
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchPayments } from "@/lib/services/payments/paymentsData.service";
import { Payment } from "@/lib/services/payments/paymentsTypes";
import { formatTime12h } from "@/lib/utils/formatTime";

const statusStyles: Record<string, string> = {
  succeeded: "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/50",
  pending: "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-amber-200 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/50",
  failed: "bg-red-500/15 text-red-700 hover:bg-red-500/25 border-red-200 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/50",
  refunded: "bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 border-blue-200 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/50",
};

const getStatusColor = (status: string) => statusStyles[status.toLowerCase()] ?? "";

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : "");

const formatDate = (date: string | null | undefined, withTime = false) =>
  date
    ? new Date(date).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(withTime && { hour: "2-digit", minute: "2-digit" }),
    })
    : "—";

interface PaymentsTableProps {
  filters?: {
    search: string;
    status: string;
  };
}

export default function PaymentsTable({ filters }: PaymentsTableProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPayments = async () => {
      setLoading(true);
      const { data } = await fetchPayments(filters);
      if (data) setPayments(data);
      setLoading(false);
    };
    loadPayments();
  }, [filters]);

  // Client-side search filter (by customer name)
  const filtered = payments.filter((p) => {
    if (!filters?.search) return true;
    const name = p.bookings?.profiles?.full_name || "";
    return name.toLowerCase().includes(filters.search.toLowerCase());
  });

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Court</TableHead>
            <TableHead>Booking Date</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Paid At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="h-32 text-center">
                <div className="flex flex-col items-center justify-center space-y-2 text-muted-foreground">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-sm">Fetching payments...</span>
                </div>
              </TableCell>
            </TableRow>
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No payments found.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((payment) => (
              <TableRow key={payment.id} className="group transition-colors hover:bg-muted/50">
                <TableCell>
                  <span className="font-medium">
                    {payment.bookings?.profiles?.full_name || "Unknown"}
                  </span>
                </TableCell>
                <TableCell>{payment.bookings?.courts?.name || "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{formatDate(payment.bookings?.booking_date)}</span>
                    {payment.bookings?.start_time && (
                      <span className="text-xs text-muted-foreground">
                        {formatTime12h(payment.bookings.start_time)} - {formatTime12h(payment.bookings.end_time)}
                      </span>
                    )}

                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  ₱{payment.amount?.toLocaleString() || 0}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={getStatusColor(payment.status)}>
                    {capitalize(payment.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {payment.paid_at
                    ? formatDate(payment.paid_at, true)
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}