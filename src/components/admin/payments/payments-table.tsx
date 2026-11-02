"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  ReceiptText,
  DollarSign,
  Undo2,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { fetchPayments, PAYMENTS_PAGE_SIZE } from "@/lib/services/payments/paymentsData.service";
import { toast } from "sonner";
import { Payment } from "@/lib/services/payments/paymentsTypes";
import { formatTime12h } from "@/lib/utils/formatTime";
import { bookingTitle } from "@/lib/services/openPlay/bookingTitle";
import { RefundPaymentModal } from "./refundPaymentModal";

interface PaymentsTableProps {
  filters?: {
    search: string;
    status: string;
  };
}

const formatDate = (date: string | null | undefined, withTime = false) => {
  if (!date) return "—";
  try {
    const day = new Date(date);
    if (isNaN(day.getTime())) return "—";
    return day.toLocaleDateString("en-US", {
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
  const value = Number(amount) || 0;
  return `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export default function PaymentsTable({ filters }: PaymentsTableProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Paid payments on cancelled bookings are owed back to the customer
  const needsRefund = (payment: Payment) => payment.status === "paid" && payment.bookings?.status === "cancelled";

  useEffect(() => {
    const loadPayments = async () => {
      setLoading(true);
      const { data } = await fetchPayments(filters);
      if (data) setPayments(data);
      setHasMore(data.length === PAYMENTS_PAGE_SIZE);
      setLoading(false);
    };
    loadPayments();
  }, [filters]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data, error } = await fetchPayments(filters, payments.length);
    if (error) toast.error("Failed to load more payments.");
    else {
      setPayments((prev) => [...prev, ...data]);
      setHasMore(data.length === PAYMENTS_PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  // Filter out any failed payments
  const validPayments = payments.filter((payment) => {
    const status = payment.status?.toLowerCase() || "";
    return status !== "failed";
  });

  // Client-side search across customer name or court name
  const filtered = validPayments.filter((payment) => {
    if (!filters?.search?.trim()) return true;
    const term = filters.search.trim().toLowerCase();
    const name = (payment.bookings?.profiles?.full_name || payment.bookings?.customer_name || "").toLowerCase();
    const court = payment.bookings?.courts?.name?.toLowerCase() || "";
    return name.includes(term) || court.includes(term);
  });

  // Financial summary metrics
  const totalVolume = validPayments
    .filter((payment) => payment.status === "succeeded" || payment.status === "paid")
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

  const succeededCount = validPayments.filter(
    (payment) => payment.status === "succeeded" || payment.status === "paid"
  ).length;

  const pendingCount = validPayments.filter((payment) => payment.status === "pending").length;

  const refunded = validPayments.filter((payment) => payment.status === "refunded");
  const refundedTotal = refunded.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

  const getStatusBadge = (status: string) => {
    const s = status?.toLowerCase() || "";
    const key = s === "paid" ? "succeeded" : s;

    const config = {
      succeeded: {
        label: "Succeeded",
        icon: CheckCircle2,
        className:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
        iconClassName: "text-emerald-600 dark:text-emerald-400",
      },
      pending: {
        label: "Pending",
        icon: Clock,
        className:
          "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
        iconClassName: "text-amber-600 dark:text-amber-400",
      },
    }[key];

    if (!config) {
      return (
        <Badge variant="outline" className="capitalize">
          {status || "Unknown"}
        </Badge>
      );
    }

    const Icon = config.icon;

    return (
      <Badge
        variant="outline"
        className={`gap-1.5 font-semibold ${config.className}`}
      >
        <Icon className={`h-3 w-3 ${config.iconClassName}`} />
        <span>{config.label}</span>
      </Badge>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Financial Summary Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
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
                {validPayments.length}
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

        {/* Spans both columns on phones so the fifth card doesn't sit alone at half width */}
        <Card className="col-span-2 lg:col-span-1 shadow-2xs border border-border bg-card">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Refunded
              </CardTitle>
              <div className="size-8 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Undo2 className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
                {formatCurrency(refundedTotal)}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {refunded.length} {refunded.length === 1 ? "payment" : "payments"} returned to customers
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Transactions Table Card */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Transaction Records</h2>
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {validPayments.length} transactions
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
                <TableHead className="text-right">Action</TableHead>
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
                    <TableCell />
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-44 text-center">
                    <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto text-center py-6">
                      <div className="p-3 rounded-full bg-muted text-muted-foreground">
                        <ReceiptText className="h-6 w-6" />
                      </div>
                      <h3 className="font-semibold text-foreground text-sm">No payment records found</h3>
                      <p className="text-xs text-muted-foreground">
                        {filters?.search || filters?.status !== "All Statuses"
                          ? "No transactions match your search or filter criteria. Try adjusting your search or filters."
                          : "No payment transactions have been recorded yet."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((payment) => (
                  <TableRow key={payment.id} className="group transition-colors hover:bg-muted/40">
                    {/* Customer */}
                    <TableCell>
                      {(() => {
                        const displayName = payment.bookings?.profiles?.full_name || payment.bookings?.customer_name || "Unknown Customer";
                        return (
                          <div className="flex items-center gap-2.5">
                            <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                              {displayName.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm text-foreground">
                              {displayName}
                            </span>
                          </div>
                        );
                      })()}
                    </TableCell>

                    {/* Court & Slot */}
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span className="font-medium text-foreground">
                          {bookingTitle(payment.bookings ?? {})}
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

                    {/* Action */}
                    <TableCell className="text-right">
                      {needsRefund(payment) && (
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => setRefundTarget(payment)}>
                          Refund
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {hasMore && !loading && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load More Payments"}
          </Button>
        </div>
      )}

      <RefundPaymentModal
        payment={refundTarget}
        open={refundTarget !== null}
        onOpenChange={(open) => !open && setRefundTarget(null)}
        onRefunded={(paymentId, status) =>
          setPayments((prev) => prev.map((p) => (p.id === paymentId ? { ...p, status } : p)))
        }
      />
    </div>
  );
}