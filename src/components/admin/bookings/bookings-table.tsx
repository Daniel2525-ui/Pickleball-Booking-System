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
import {
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  CalendarX,
  Loader2,
  Banknote,
  Smartphone,
  ReceiptText,
  Clock,
  CircleDollarSign,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { fetchBookings, BOOKINGS_PAGE_SIZE } from "@/lib/services/bookings/filterBookingsData.service";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { Booking, BookingPayment } from "@/lib/services/bookings/bookingsTypes";
import { formatTime12h, formatDate } from "@/lib/utils/formatTime";
import { SettlePaymentModal } from "./settlePaymentModal";
import { VerifyGcashModal } from "./verifyGcashModal";
import { MoveBookingModal, MovedBooking } from "./moveBookingModal";
import { BookingHistoryModal } from "./bookingHistoryModal";
import { CancelPaidModal } from "./cancelPaidModal";
import { getBookingStart, getBookingEnd } from "@/lib/utils/bookingTime";
import { ArrowRightLeft, History } from "lucide-react";
import { counterSettlementDue } from "@/lib/services/bookings/basketSiblings";
import { getBookingDisplayStatus, isAwaitingVerification } from "@/lib/services/bookings/bookingDisplayStatus";
import { bookingTitle, bookingRef } from "@/lib/services/openPlay/bookingTitle";
import { gameDayBlockReason } from "@/lib/services/bookings/adminStatusRules";
import { updateBookingStatus, GameDayStatus } from "@/lib/services/bookings/updateBookingStatus.service";

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-semibold",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-semibold",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20 font-semibold",
  checked_in: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 font-semibold",
  in_progress: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20 font-semibold",
  completed: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20 font-semibold",
  no_show: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20 font-semibold",
  expired: "bg-muted text-muted-foreground border-border font-semibold",
  awaiting_verification: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 font-semibold",
  hold_expired: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-dashed border-orange-500/40 font-semibold",
};

const getStatusColor = (status: string) => statusStyles[status?.toLowerCase()] ?? "bg-muted text-muted-foreground";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  cancelled: "Cancelled",
  checked_in: "Checked In",
  in_progress: "In Progress",
  completed: "Completed",
  no_show: "No-Show",
  expired: "Expired",
  awaiting_verification: "Awaiting verification",
  hold_expired: "Hold Expired",
};
const capitalize = (status: string) => STATUS_LABELS[status?.toLowerCase()] ?? (status ? status[0].toUpperCase() + status.slice(1) : "");


const columnCount = 6;

interface BookingsTableProps {
  filters?: {
    search: string;
    status: string;
    courtId: string;
    dateTime: string;
  };
}

// Cancelling a pending court cancels its whole unpaid basket (/api/admin/bookings/status)
const cancelsWith = (b: Booking, target: Booking) =>
  b.id === target.id ||
  (target.status === "pending" && !!target.basket_id && b.basket_id === target.basket_id && b.status === "pending");

export default function BookingsTable({ filters }: BookingsTableProps = {}) {
  const [bookingsData, setBookingsData] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  // Settle payment modal state
  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [selectedBookingForSettle, setSelectedBookingForSettle] = useState<Booking | null>(null);

  const [verifyBooking, setVerifyBooking] = useState<Booking | null>(null);
  const [moveBooking, setMoveBooking] = useState<Booking | null>(null);
  const [historyBooking, setHistoryBooking] = useState<Booking | null>(null);
  const [cancelPaid, setCancelPaid] = useState<Booking | null>(null);

  const handleMoved = (bookingId: string, moved: MovedBooking, courtName: string) =>
    setBookingsData((prev) => prev.map((b) => (b.id === bookingId ? { ...b, ...moved, courts: { name: courtName } } : b)));

  useEffect(() => {
    // A slower answer for an older filter must not replace the newer one
    let ignore = false;
    const loadBookingsData = async () => {
      setLoading(true);
      const { data, error } = await fetchBookings(filters);
      if (ignore) return;
      // A failed load is not an empty day: say so instead of showing "No matching reservations"
      if (error) toast.error("Could not load reservations. Refresh the page to try again.");
      setBookingsData(data);
      setHasMore(data.length === BOOKINGS_PAGE_SIZE);
      setLoading(false);
    };
    loadBookingsData();
    return () => {
      ignore = true;
    };
  }, [filters]);

  // A change made elsewhere (another desk, a player, the payment webhook) reloads the first page quietly.
  // Rows loaded with "load more" are dropped rather than kept, since a new booking shifts every page by one
  useLiveRefresh(async () => {
    const { data, error } = await fetchBookings(filters);
    if (error) return;
    setBookingsData(data);
    setHasMore(data.length === BOOKINGS_PAGE_SIZE);
  });

  const loadMore = async () => {
    setLoadingMore(true);
    const { data, error } = await fetchBookings(filters, bookingsData.length);
    if (error) toast.error("Failed to load more reservations.");
    else {
      setBookingsData((prev) => [...prev, ...data]);
      setHasMore(data.length === BOOKINGS_PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  const handleCancelBooking = (booking: Booking) => {
    if (actionLoadingId) return;
    // A paid booking: staff choose whether the payment is refunded or kept
    const payment = Array.isArray(booking.payments) ? booking.payments[0] : booking.payments;
    if (payment?.status === "paid") return setCancelPaid(booking);
    setConfirmRequest({
      title: "Cancel this reservation?",
      description: `${booking.customer_name || "This player"}'s reservation will be cancelled and the court slot released.`,
      confirmLabel: "Cancel Reservation",
      onConfirm: () => cancelBooking(booking),
    });
  };

  const cancelBooking = async (booking: Booking, keep?: { note: string }) => {
    setActionLoadingId(booking.id);
    const { error } = await updateBookingStatus(booking.id, "cancelled", keep);
    if (error) {
      toast.error(error);
    } else {
      setBookingsData((prev) =>
        prev.map((b) =>
          cancelsWith(b, booking) ? { ...b, status: "cancelled", ...(keep && { cancel_reason: "payment_kept" }) } : b
        )
      );
      toast.success(keep ? "Reservation cancelled. The payment was kept." : "Reservation cancelled successfully.");
    }
    setActionLoadingId(null);
    return !error;
  };

  const handleStatusChange = (booking: Booking, newStatus: GameDayStatus) => {
    if (actionLoadingId) return;

    if (newStatus === "no_show") {
      setConfirmRequest({
        title: "Mark as no-show?",
        description:
          "The court slot is released immediately, even if the player arrives late.\nPayment status will not change.",
        confirmLabel: "Mark No-Show",
        onConfirm: () => changeStatus(booking, newStatus),
      });
      return;
    }
    changeStatus(booking, newStatus);
  };

  const changeStatus = async (booking: Booking, newStatus: GameDayStatus) => {
    setActionLoadingId(booking.id);
    const { error } = await updateBookingStatus(booking.id, newStatus);
    if (error) {
      toast.error(error);
    } else {
      const label: Record<GameDayStatus, string> = {
        checked_in: "Player checked in.",
        in_progress: "Match started.",
        completed: "Booking marked as played.",
        no_show: "Booking marked as no-show. Court slot released.",
        cancelled: "Booking cancelled. Court slot released.",
      };
      setBookingsData((prev) =>
        prev.map((b) =>
          b.id === booking.id || (newStatus === "cancelled" && cancelsWith(b, booking)) ? { ...b, status: newStatus } : b
        )
      );
      toast.success(label[newStatus]);
    }
    setActionLoadingId(null);
  };

  const handlePaymentSettled = (bookingIds: string[], paymentMethod: string) => {
    setBookingsData((prev) =>
      prev.map((b) => {
        if (!bookingIds.includes(b.id)) return b;
        const payment = Array.isArray(b.payments) ? b.payments[0] : b.payments;
        return {
          ...b,
          status: "confirmed",
          payments: payment ? [{ ...payment, status: "paid", payment_method: paymentMethod } as BookingPayment] : b.payments,
        };
      })
    );
  };

  const handleGcashVerified = (bookingIds: string[], action: "approve" | "reject") => {
    if (action === "approve") return handlePaymentSettled(bookingIds, "gcash");
    setBookingsData((prev) =>
      prev.map((b) => {
        if (!bookingIds.includes(b.id)) return b;
        const payment = Array.isArray(b.payments) ? b.payments[0] : b.payments;
        return {
          ...b,
          status: "cancelled",
          cancel_reason: "gcash_rejected",
          payments: payment ? [{ ...payment, status: "failed" } as BookingPayment] : b.payments,
        };
      })
    );
  };

  const renderPaymentBadge = (booking: Booking) => {
    const payment = Array.isArray(booking.payments) ? booking.payments[0] : (booking.payments ?? null);
    if (!payment) return null;

    if (payment.status === "paid") {
      const method = payment.payment_method?.toLowerCase();
      if (method === "cash") {
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[11px] font-semibold gap-1">
            <Banknote className="size-3" />
            Paid • Cash
          </Badge>
        );
      }
      if (method === "gcash") {
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 text-[11px] font-semibold gap-1">
            <Smartphone className="size-3" />
            Paid • QR Ph
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[11px] font-semibold gap-1">
          <CheckCircle2 className="size-3" />
          Paid • Online
        </Badge>
      );
    }

    if (payment.status === "pending") {
      return (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[11px] font-semibold gap-1">
          <Clock className="size-3" />
          Unpaid
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="text-[11px] capitalize">
        {payment.status}
      </Badge>
    );
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 border-b border-border shadow-2xs">
              <TableRow>
                <TableHead>Player / Booker</TableHead>
                <TableHead>Court</TableHead>
                <TableHead>Match Schedule</TableHead>
                <TableHead className="text-right">Total Fee</TableHead>
                <TableHead>Status & Payment</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
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
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        There are no court bookings matching your current filter criteria. Try adjusting the court selection or clearing the search.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                bookingsData.map((booking) => {
                  const payment = Array.isArray(booking.payments) ? booking.payments[0] : (booking.payments ?? null);
                  const displayStatus = getBookingDisplayStatus(booking);
                  // An expired online hold cannot be revived at the counter (settle_counter_payment refuses it)
                  // Verify replaces counter collection for a submitted GCash basket, which must stay one unit
                  const awaiting = isAwaitingVerification(booking);
                  // Spot rows are settled through the session's players (court-reserving rows are filtered out by fetchBookings)
                  const isSpot = !!booking.open_play_spots;
                  const canCollect = !isSpot && payment?.status === "pending" && displayStatus !== "hold_expired" && booking.status !== "cancelled" && !awaiting;

                  return (
                    <TableRow key={booking.id} className="group">
                      {/* Player info */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground text-sm">
                            {booking.customer_name || booking.profiles?.full_name || "Guest Player"}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {booking.customer_id ? "Walk-In Guest" : "Registered Member"} · <span className="font-mono">Ref {bookingRef(booking.id)}</span>
                            {(booking.basket_size ?? 1) > 1 && (
                              <span className="ml-1.5 rounded bg-muted px-1.5 py-px font-semibold text-foreground">Group · {booking.basket_size} courts</span>
                            )}
                          </span>
                          {(booking.customers?.phone || booking.profiles?.phone) && (
                            <a
                              href={`tel:${booking.customers?.phone || booking.profiles?.phone}`}
                              className="w-fit text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            >
                              {booking.customers?.phone || booking.profiles?.phone}
                            </a>
                          )}
                        </div>
                      </TableCell>

                      {/* Court */}
                      <TableCell>
                        <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold text-xs">
                          {isSpot ? bookingTitle(booking) : booking.courts?.name || `Court ${booking.court_id}`}
                        </span>
                      </TableCell>

                      {/* Schedule */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground text-xs sm:text-sm">
                            {formatDate(booking.booking_date)}
                          </span>
                          <span className="text-xs text-muted-foreground mt-0.5">
                            {formatTime12h(booking.start_time)} – {formatTime12h(booking.end_time)}
                          </span>
                          {/* Recorded after the game ended: lets the owner review late entries */}
                          {new Date(booking.created_at) > getBookingEnd(booking) && (
                            <Badge variant="outline" title="Recorded after this game ended" className="mt-1 w-fit text-[11px] bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20">
                              Entered late
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      {/* Total Fee */}
                      <TableCell className="text-right font-black text-foreground text-sm">
                        ₱{booking.total_amount ? booking.total_amount.toLocaleString() : "0"}
                      </TableCell>

                      {/* Reservation and Payment Status */}
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="outline" className={`text-xs capitalize ${getStatusColor(displayStatus)}`}>
                            {capitalize(displayStatus)}
                          </Badge>
                          {renderPaymentBadge(booking)}
                        </div>
                      </TableCell>

                      {/* Action Dropdown Menu */}
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

                              {awaiting && (
                                <DropdownMenuItem
                                  onClick={() => setVerifyBooking(booking)}
                                  className="cursor-pointer text-blue-600 focus:text-blue-600 text-xs font-semibold"
                                >
                                  <ReceiptText className="mr-2 h-4 w-4" />
                                  Verify
                                </DropdownMenuItem>
                              )}

                              {/* Collect Payment Action if Unpaid */}
                              {canCollect && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedBookingForSettle(booking);
                                    setSettleModalOpen(true);
                                  }}
                                  className="cursor-pointer text-emerald-600 focus:text-emerald-600 text-xs font-semibold"
                                >
                                  <CircleDollarSign className="mr-2 h-4 w-4" />
                                  Collect Payment
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuItem onClick={() => setHistoryBooking(booking)} className="cursor-pointer text-xs font-semibold">
                                <History className="mr-2 h-4 w-4" />
                                History
                              </DropdownMenuItem>

                              {/* Move to another court or time before it starts (move_booking re-checks every rule) */}
                              {booking.status?.toLowerCase() === "confirmed" && !isSpot && getBookingStart(booking) > new Date() && (
                                <DropdownMenuItem
                                  onClick={() => setMoveBooking(booking)}
                                  className="cursor-pointer text-xs font-semibold"
                                >
                                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                                  Move Booking
                                </DropdownMenuItem>
                              )}

                              {/* Game-Day Actions */}
                              {booking.status?.toLowerCase() === "confirmed" && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => handleStatusChange(booking, "checked_in")}
                                    disabled={actionLoadingId === booking.id || !!gameDayBlockReason("checked_in", booking)}
                                    title={gameDayBlockReason("checked_in", booking) ?? undefined}
                                    className="cursor-pointer text-blue-600 focus:text-blue-600 text-xs font-semibold"
                                  >
                                    {actionLoadingId === booking.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                                    Check In Player
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleStatusChange(booking, "no_show")}
                                    disabled={actionLoadingId === booking.id}
                                    className="cursor-pointer text-orange-600 focus:text-orange-600 text-xs font-semibold"
                                  >
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    Mark No-Show
                                  </DropdownMenuItem>
                                </>
                              )}

                              {/* Contingency: staff forgot to check in a group that played */}
                              {booking.status?.toLowerCase() === "no_show" && (
                                <DropdownMenuItem
                                  onClick={() => handleStatusChange(booking, "completed")}
                                  disabled={actionLoadingId === booking.id || !!gameDayBlockReason("completed", booking)}
                                  title={gameDayBlockReason("completed", booking) ?? undefined}
                                  className="cursor-pointer text-emerald-600 focus:text-emerald-600 text-xs font-semibold"
                                >
                                  {actionLoadingId === booking.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                  Mark as Played
                                </DropdownMenuItem>
                              )}

                              {/* Awaiting GCash: approve first, so a cancel goes through the refund-owed flow */}
                              {booking.status?.toLowerCase() !== "cancelled" && !awaiting && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleCancelBooking(booking)}
                                    disabled={actionLoadingId === booking.id}
                                    className="cursor-pointer text-destructive focus:text-destructive text-xs font-semibold"
                                  >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    Cancel Reservation
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {hasMore && !loading && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load More Reservations"}
          </Button>
        </div>
      )}

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />

      {/* Settle Payment Modal */}
      <SettlePaymentModal
        booking={selectedBookingForSettle}
        due={selectedBookingForSettle ? counterSettlementDue(selectedBookingForSettle, bookingsData) : null}
        open={settleModalOpen}
        onOpenChange={setSettleModalOpen}
        onSettled={handlePaymentSettled}
      />

      <CancelPaidModal booking={cancelPaid} onClose={() => setCancelPaid(null)} onConfirm={cancelBooking} />

      <BookingHistoryModal booking={historyBooking} onClose={() => setHistoryBooking(null)} />

      <MoveBookingModal booking={moveBooking} onClose={() => setMoveBooking(null)} onMoved={handleMoved} />

      <VerifyGcashModal
        key={verifyBooking?.id}
        booking={verifyBooking}
        open={!!verifyBooking}
        onOpenChange={(open) => !open && setVerifyBooking(null)}
        onVerified={handleGcashVerified}
      />
    </>
  );
}