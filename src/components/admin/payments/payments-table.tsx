"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  XCircle,
  RotateCcw,
  ReceiptText,
  DollarSign,
} from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchPayments } from "@/lib/services/payments/paymentsData.service";
import { Payment } from "@/lib/services/payments/paymentsTypes";
import { formatTime12h } from "@/lib/utils/formatTime";

interface PaymentsTableProps {
  filters?: {
    search: string;
    status: string;
  };
  onResetFilters?: () => void;
}

const formatDate = (date: string | null | undefined, withTime = false) => {
  if (!date) return "—";
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(withTime && { hour: "numeric", minute: "2-digit", hour12: true }),
    });
  } catch {
    return "—";
  }
};

const formatCurrency = (amount: number | null | undefined) => {
  const val = Number(amount) || 0;
  return `₱${val.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export default function PaymentsTable({ filters, onResetFilters }: PaymentsTableProps) {
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

  // Client-side search across customer name or court name
  const filtered = payments.filter((p) => {
    if (!filters?.search?.trim()) return true;
    const term = filters.search.trim().toLowerCase();
    const name = p.bookings?.profiles?.full_name?.toLowerCase() || "";
    const court = p.bookings?.courts?.name?.toLowerCase() || "";
    return name.includes(term) || court.includes(term);
  });

  // Financial summary metrics
  const totalVolume = payments
    .filter((p) => p.status === "succeeded" || p.status === "paid")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const succeededCount = payments.filter(
    (p) => p.status === "succeeded" || p.status === "paid"
  ).length;

  const pendingCount = payments.filter((p) => p.status === "pending").length;

  const getStatusBadge = (status: string) => {
    const s = status?.toLowerCase() || "";
    switch (s) {
      case "paid":
      case "succeeded":
        return (
          <Badge
            variant="outline"
            className="gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 font-semibold"
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span>Succeeded</span>
          </Badge>
        );
      case "pending":
        return (
          <Badge
            variant="outline"
            className="gap-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20 font-semibold"
          >
            <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
            <span>Pending</span>
          </Badge>
        );
      case "failed":
        return (
          <Badge
            variant="outline"
            className="gap-1.5 bg-destructive/10 text-destructive border-destructive/20 font-semibold"
          >
            <XCircle className="h-3 w-3 text-destructive" />
            <span>Failed</span>
          </Badge>
        );
      case "refunded":
        return (
          <Badge
            variant="outline"
            className="gap-1.5 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 font-semibold"
          >
            <RotateCcw className="h-3 w-3 text-blue-600 dark:text-blue-400" />
            <span>Refunded</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="capitalize">
            {status || "Unknown"}
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Financial Summary Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="shadow-2xs border border-border bg-card">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Total Succeeded Volume
              </CardTitle>
              <div className="size-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <DollarSign className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
                {formatCurrency(totalVolume)}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Gross settled revenue</p>
          </CardContent>
        </Card>

        <Card className="shadow-2xs border border-border bg-card">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Total Transactions
              </CardTitle>
              <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <ReceiptText className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
                {payments.length}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Recorded in current view</p>
          </CardContent>
        </Card>

        <Card className="shadow-2xs border border-border bg-card">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Successful Payments
              </CardTitle>
              <div className="size-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
                {succeededCount}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Completed transactions</p>
          </CardContent>
        </Card>

        <Card className="shadow-2xs border border-border bg-card">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Pending / Unpaid
              </CardTitle>
              <div className="size-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Clock className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
                {pendingCount}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Awaiting settlement</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Transactions Table Card */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Transaction Records</h2>
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {payments.length} transactions
            </p>
          </div>
        </div>

        <div className="max-h-[600px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-xs border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead>Customer</TableHead>
                <TableHead>Court & Slot</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Processed At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-6 w-24 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-44 text-center">
                    <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto text-center py-6">
                      <div className="p-3 rounded-full bg-muted text-muted-foreground">
                        <ReceiptText className="h-6 w-6" />
                      </div>
                      <h3 className="font-semibold text-foreground text-sm">No payment records found</h3>
                      <p className="text-xs text-muted-foreground">
                        {filters?.search || filters?.status !== "All Statuses"
                          ? "No transactions match your search or filter criteria. Try resetting filters."
                          : "No payment transactions have been recorded yet."}
                      </p>
                      {onResetFilters && (filters?.search || filters?.status !== "All Statuses") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onResetFilters}
                          className="mt-2 text-xs"
                        >
                          Clear Filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((payment) => (
                  <TableRow key={payment.id} className="group transition-colors hover:bg-muted/40">
                    {/* Customer */}
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                          {payment.bookings?.profiles?.full_name?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <span className="font-medium text-sm text-foreground">
                          {payment.bookings?.profiles?.full_name || "Unknown Customer"}
                        </span>
                      </div>
                    </TableCell>

                    {/* Court & Slot */}
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span className="font-medium text-foreground">
                          {payment.bookings?.courts?.name || "Court"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(payment.bookings?.booking_date)}
                          {payment.bookings?.start_time && (
                            <> • {formatTime12h(payment.bookings.start_time)} - {formatTime12h(payment.bookings.end_time)}</>
                          )}
                        </span>
                      </div>
                    </TableCell>

                    {/* Amount */}
                    <TableCell className="text-right">
                      <span className="font-bold text-foreground text-sm">
                        {formatCurrency(payment.amount)}
                      </span>
                    </TableCell>

                    {/* Status */}
                    <TableCell className="text-center">
                      {getStatusBadge(payment.status)}
                    </TableCell>

                    {/* Paid At */}
                    <TableCell>
                      <div className="flex flex-col text-xs text-muted-foreground">
                        <span>{formatDate(payment.paid_at || payment.created_at, true)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}