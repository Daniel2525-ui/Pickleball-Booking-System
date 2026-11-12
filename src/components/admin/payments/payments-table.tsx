"use client";

import { useEffect, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
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
import { fetchPayments, fetchPaymentTotals, PAYMENTS_PAGE_SIZE } from "@/lib/services/payments/paymentsData.service";
import { toast } from "sonner";
import { Payment, paymentMethodLabel, sumPayments } from "@/lib/services/payments/paymentsTypes";
import { formatTime12h, formatDate } from "@/lib/utils/formatTime";
import { bookingTitle, bookingRef } from "@/lib/services/openPlay/bookingTitle";
import { RefundPaymentModal } from "./refundPaymentModal";

interface PaymentsTableProps {
  filters?: {
    search: string;
    status: string;
    date: string;
  };
}


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
  const [totals, setTotals] = useState<ReturnType<typeof sumPayments> | null>(null);
  // Bumped after a refund so the day's totals reload
  const [totalsVersion, setTotalsVersion] = useState(0);
  const date = filters?.date ?? "";

  // Paid payments on cancelled bookings are owed back to the customer
  const needsRefund = (payment: Payment) =>
    payment.status === "paid" && payment.bookings?.status === "cancelled" && payment.bookings?.cancel_reason !== "payment_kept";

  // Where the latest online refund for an owed payment stands. The app cannot send a QR Ph refund itself, so every state asks staff to do it
  const cardRefundState = (payment: Payment) => {
    const latest = [...(payment.refund_requests ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    switch (latest?.status) {
      case "pending":
      case "processing":
      case "pending":
      case "processing":
      case "requires_admin_review":
      case "failed":
        return { label: "Refund not sent yet: send it from Xendit, then record it", tone: "text-amber-700 dark:text-amber-400", retry: false };
      default:
        return null;
    }
  };

  useEffect(() => {
    // A slower answer for an older filter must not replace the newer one
    let ignore = false;
    const loadPayments = async () => {
      setLoading(true);
      const { data, error } = await fetchPayments(filters);
      if (ignore) return;
      // A failed load is not an empty day: say so instead of showing "No payment records found"
      if (error) toast.error("Could not load payments. Refresh the page to try again.");
      setPayments(data);
      setHasMore(data.length === PAYMENTS_PAGE_SIZE);
      setLoading(false);
    };
    loadPayments();
    return () => {
      ignore = true;
    };
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    if (date) fetchPaymentTotals(date).then(({ data }) => !ignore && setTotals(data));
    return () => {
      ignore = true;
    };
  }, [date, totalsVersion]);

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

  // Search runs on the server (fetchPayments); failed rows are hidden above
  const filtered = validPayments;

  const dayLabel = date
    ? new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" })
    : "";
  const money = (n: number | undefined) => (!date ? "—" : totals ? formatCurrency(n) : null);
  const summaryCards = [
    { title: "Collected", value: money(totals?.collected), note: totals ? `${totals.collectedCount} ${totals.collectedCount === 1 ? "payment" : "payments"} · ${dayLabel}` : dayLabel, icon: DollarSign, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    { title: "Cash", value: money(totals?.cash), note: "Should be in the drawer", icon: Banknote, tone: "bg-lime-500/10 text-lime-700 dark:text-lime-400" },
    { title: "QR Ph", value: money(totals ? totals.gcash + totals.card : undefined), note: "Online and front desk. Check against Xendit", icon: CreditCard, tone: "bg-primary/10 text-primary" },
    { title: "Refunded", value: money(totals?.refunded), note: totals ? `${totals.refundedCount} returned to customers` : "", icon: Undo2, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  ];

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
      {/* The chosen day's money, split by method for closing out the drawer */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {summaryCards.map(({ title, value, note, icon: Icon, tone }) => (
          <Card key={title} className="gap-0 py-0 shadow-none">
            <CardHeader className="px-4 pt-4 pb-1">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
                <Icon className={`size-4 shrink-0 ${tone.split(" ").find((c) => c.startsWith("text-")) ?? "text-primary"}`} aria-hidden />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {value === null ? (
                <Skeleton className="h-8 w-24 mt-1" />
              ) : (
                <p className="font-display text-2xl sm:text-3xl font-bold text-foreground tabular-nums">{value}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">{date ? note : "Pick a date to see totals"}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Transactions Table Card */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Transaction Records</h2>
            <p className="text-xs text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}{dayLabel ? ` · ${dayLabel}` : " · all dates"}
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
                <TableHead>Status</TableHead>
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
                    <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
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
                          : date
                            ? "No payments on this day yet. Clear the date to see every day."
                            : "No payment transactions have been recorded yet."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((payment) => (
                  <TableRow key={payment.id} className="group">
                    {/* Customer */}
                    <TableCell>
                      {(() => {
                        const displayName = payment.bookings?.profiles?.full_name || payment.bookings?.customer_name || "Unknown Customer";
                        return (
                          <div className="flex items-center gap-2.5">
                            <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                              {displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-medium text-sm text-foreground">{displayName}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">Ref {bookingRef({ id: payment.booking_id, basket_id: payment.bookings?.basket_id })}</span>
                            </div>
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
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-foreground text-sm">{formatCurrency(payment.amount)}</span>
                        <span className="text-[11px] text-muted-foreground">{paymentMethodLabel(payment)}</span>
                      </div>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
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
                      {needsRefund(payment) && (() => {
                        const refundState = cardRefundState(payment);
                        return (
                          <div className="flex flex-col items-end gap-1">
                            <Button size="sm" variant="outline" className="text-xs" onClick={() => setRefundTarget(payment)}>
                              {refundState?.retry ? "Retry refund" : "Refund"}
                            </Button>
                            {refundState && (
                              <span className={`text-[11px] font-semibold ${refundState.tone}`}>{refundState.label}</span>
                            )}
                          </div>
                        );
                      })()}
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
        onRefunded={(paymentId, status) => {
          setPayments((prev) => prev.map((p) => (p.id === paymentId ? { ...p, status } : p)));
          setTotalsVersion((v) => v + 1);
        }}
      />
    </div>
  );
}