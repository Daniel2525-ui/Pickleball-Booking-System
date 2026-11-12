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
  Clock,
  CircleDollarSign,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Fragment, useEffect, useState } from "react";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { fetchBookings, BOOKINGS_PAGE_SIZE } from "@/lib/services/bookings/filterBookingsData.service";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { Booking, BookingPayment } from "@/lib/services/bookings/bookingsTypes";
import { formatTime12h, formatDate } from "@/lib/utils/formatTime";
import { SettlePaymentModal } from "./settlePaymentModal";
import { MoveBookingModal, MovedBooking } from "./moveBookingModal";
import { BookingHistoryModal } from "./bookingHistoryModal";
import { CancelPaidModal } from "./cancelPaidModal";
import { getBookingStart, getBookingEnd } from "@/lib/utils/bookingTime";
import { ArrowRightLeft, History, PanelRight } from "lucide-react";
import { BookingDetailsSheet, type BookingAction } from "./booking-details-sheet";
import { counterSettlementDue } from "@/lib/services/bookings/basketSiblings";
import { groupByCheckout, checkoutTotal } from "@/lib/services/bookings/basket";
import { bookingPaymentLabel } from "@/lib/services/payments/paymentsTypes";
import { getBookingDisplayStatus } from "@/lib/services/bookings/bookingDisplayStatus";
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
  hold_expired: "Hold Expired",
};
const capitalize = (status: string) => STATUS_LABELS[status?.toLowerCase()] ?? (status ? status[0].toUpperCase() + status.slice(1) : "");


const columnCount = 6;

const firstPayment = (b: Booking) => (Array.isArray(b.payments) ? b.payments[0] : b.payments) ?? null;
const paymentLabel = (b: Booking) => {
  const payment = firstPayment(b);
  return payment ? bookingPaymentLabel(b, payment) : null;
};

interface BookingsTableProps {
  /** booking_settings.day_ends_at: check-in is allowed on the booking's business day */
  dayEndsAt?: string;
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

export default function BookingsTable({ filters, dayEndsAt }: BookingsTableProps = {}) {
  const blockReason = (status: string, b: Parameters<typeof gameDayBlockReason>[1]) => gameDayBlockReason(status, b, new Date(), dayEndsAt);
  const [bookingsData, setBookingsData] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  // Settle payment modal state
  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [selectedBookingForSettle, setSelectedBookingForSettle] = useState<Booking | null>(null);

  const [moveBooking, setMoveBooking] = useState<Booking | null>(null);
  const [historyBooking, setHistoryBooking] = useState<Booking | null>(null);
  const [cancelPaid, setCancelPaid] = useState<Booking | null>(null);
  // By id, so the panel shows the row as it is after an action or a live refresh
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsBooking = bookingsData.find((b) => b.id === detailsId) ?? null;

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

  const checkInAll = async (courts: Booking[]) => {
    if (actionLoadingId) return;
    setActionLoadingId(courts[0].id);
    const results = await Promise.all(courts.map((c) => updateBookingStatus(c.id, "checked_in")));
    const done = courts.filter((_, i) => !results[i].error).map((c) => c.id);
    setBookingsData((prev) => prev.map((b) => (done.includes(b.id) ? { ...b, status: "checked_in" } : b)));
    const failed = courts.filter((_, i) => results[i].error);
    if (failed.length) {
      toast.error(`Could not check in ${failed.map((c) => c.courts?.name || "a court").join(", ")}: ${results.find((r) => r.error)!.error}`);
    } else {
      toast.success(`${done.length} ${done.length === 1 ? "booking" : "bookings"} checked in.`);
    }
    setActionLoadingId(null);
  };

  // What the desk can do with a booking now. The row menu and the details panel both show this list.
  const actionsFor = (booking: Booking): BookingAction[] => {
    const payment = firstPayment(booking);
    const displayStatus = getBookingDisplayStatus(booking);
    const status = booking.status?.toLowerCase();
    // An expired online hold cannot be revived at the counter (settle_counter_payment refuses it)
    // Spot rows are settled through the session's players (court-reserving rows are filtered out by fetchBookings)
    const isSpot = !!booking.open_play_spots;
    const canCollect = !isSpot && payment?.status === "pending" && displayStatus !== "hold_expired" && booking.status !== "cancelled";
    const busy = actionLoadingId === booking.id;
    const list: BookingAction[] = [];
    if (canCollect) {
      list.push({ key: "collect", label: "Collect Payment", icon: CircleDollarSign, tone: "text-emerald-600 focus:text-emerald-600",
        onClick: () => { setSelectedBookingForSettle(booking); setSettleModalOpen(true); } });
    }
    if (status === "confirmed") {
      list.push({ key: "checkin", label: "Check In Player", icon: busy ? Loader2 : UserCheck, tone: "text-blue-600 focus:text-blue-600",
        disabled: busy || !!blockReason("checked_in", booking), title: blockReason("checked_in", booking) ?? undefined,
        onClick: () => handleStatusChange(booking, "checked_in") });
    }
    // Move to another court or time before it starts (move_booking re-checks every rule)
    if (status === "confirmed" && !isSpot && getBookingStart(booking) > new Date()) {
      list.push({ key: "move", label: "Move Booking", icon: ArrowRightLeft, onClick: () => setMoveBooking(booking) });
    }
    if (status === "confirmed") {
      list.push({ key: "noshow", label: "Mark No-Show", icon: AlertTriangle, tone: "text-orange-600 focus:text-orange-600", disabled: busy,
        onClick: () => handleStatusChange(booking, "no_show") });
    }
    // Contingency: staff forgot to check in a group that played
    if (status === "no_show") {
      list.push({ key: "played", label: "Mark as Played", icon: busy ? Loader2 : CheckCircle2, tone: "text-emerald-600 focus:text-emerald-600",
        disabled: busy || !!blockReason("completed", booking), title: blockReason("completed", booking) ?? undefined,
        onClick: () => handleStatusChange(booking, "completed") });
    }
    if (status !== "cancelled") {
      list.push({ key: "cancel", label: "Cancel Reservation", icon: XCircle, destructive: true, tone: "text-destructive focus:text-destructive",
        disabled: busy, onClick: () => handleCancelBooking(booking) });
    }
    return list;
  };

  const renderPaymentBadge = (booking: Booking) => {
    const payment = firstPayment(booking);
    if (!payment) return null;
    const label = bookingPaymentLabel(booking, payment);
    const paid = label.startsWith("Paid");
    const waiting = label === "Unpaid" || label === "Refund owed";
    const Icon = paid ? (payment.payment_method?.toLowerCase() === "cash" ? Banknote : Smartphone) : waiting ? Clock : null;
    const tone = paid
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
      : waiting
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
        : "";
    return (
      <Badge variant="outline" className={`text-[11px] font-semibold gap-1 capitalize ${tone}`}>
        {Icon && <Icon className="size-3" />}
        {label}
      </Badge>
    );
  };

  return (
    <>
      <div className="rounded-2xl border bg-card overflow-hidden">
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
                // One block per checkout: a header line with what the courts share, then a line per court
                groupByCheckout(bookingsData).flatMap((group) => {
                  const grouped = group.length > 1;
                  const courts = [...group].sort((a, b) => getBookingStart(a).getTime() - getBookingStart(b).getTime());
                  const head = courts[0];
                  const size = head.basket_size ?? courts.length;
                  // Every court loaded: total from the rows, so a status changed here shows at once
                  const total = courts.length >= size ? checkoutTotal(courts) : head.basket_total ?? checkoutTotal(courts);
                  const sameDate = courts.every((c) => c.booking_date === head.booking_date);
                  const samePayment = new Set(courts.map(paymentLabel)).size === 1;
                  const toCheckIn = courts.filter((c) => c.status === "confirmed" && !c.open_play_spots && !blockReason("checked_in", c));
                  const phone = head.customers?.phone || head.profiles?.phone;

                  return [
                    grouped && (
                      <TableRow key={`group-${head.basket_id}`} className="bg-muted/40 hover:bg-muted/40">
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground text-sm">
                              {head.customer_name || head.profiles?.full_name || "Guest Player"}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {head.customer_id ? "Walk-In Guest" : "Registered Member"} · <span className="font-mono">Ref {bookingRef(head)}</span>
                              {phone && (
                                <> · <a href={`tel:${phone}`} className="underline-offset-2 hover:text-foreground hover:underline">{phone}</a></>
                              )}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground whitespace-nowrap">
                            {/* A line is a court at a time, and one court can be booked twice: count bookings, not courts */}
                            {courts.length < size ? `${courts.length} of ${size} bookings` : `${size} bookings`}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium text-foreground text-xs sm:text-sm">
                          {sameDate && formatDate(head.booking_date)}
                        </TableCell>
                        <TableCell className="text-right font-black text-foreground text-sm">₱{total.toLocaleString()}</TableCell>
                        <TableCell>{samePayment && renderPaymentBadge(head)}</TableCell>
                        <TableCell className="text-right">
                          {toCheckIn.length > 0 && (
                            <Button size="sm" variant="outline" disabled={!!actionLoadingId} onClick={() => checkInAll(toCheckIn)}>
                              <UserCheck className="mr-1.5 h-4 w-4" />
                              Check in all
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ),
                    ...courts.map((booking) => {
                  const displayStatus = getBookingDisplayStatus(booking);
                  const isSpot = !!booking.open_play_spots;

                  return (
                    <TableRow key={booking.id} className="group">
                      {/* Player info */}
                      <TableCell>
                        {/* A grouped line's player and ref are on its header line */}
                        {grouped ? null : (
                        <div className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => setDetailsId(booking.id)}
                            className="w-fit text-left font-semibold text-foreground text-sm hover:text-primary hover:underline underline-offset-4"
                          >
                            {booking.customer_name || booking.profiles?.full_name || "Guest Player"}
                          </button>
                          <span className="text-[11px] text-muted-foreground">
                            {booking.customer_id ? "Walk-In Guest" : booking.profiles?.is_guest ? "Online guest (no account)" : "Registered Member"} · <span className="font-mono">Ref {bookingRef(booking)}</span>
                            {booking.player_count ? <> · {booking.player_count} {booking.player_count === 1 ? "player" : "players"}</> : null}
                            {booking.discount_codes?.code && <> · Code {booking.discount_codes.code}</>}
                            {(booking.basket_size ?? 1) > 1 && (
                              <span className="ml-1.5 rounded bg-muted px-1.5 py-px font-semibold text-foreground">Group · {booking.basket_size} bookings</span>
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
                        )}
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
                          {(!grouped || !sameDate) && (
                            <span className="font-medium text-foreground text-xs sm:text-sm">
                              {formatDate(booking.booking_date)}
                            </span>
                          )}
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
                      <TableCell className={grouped ? "text-right text-xs text-muted-foreground" : "text-right font-black text-foreground text-sm"}>
                        ₱{booking.total_amount ? booking.total_amount.toLocaleString() : "0"}
                      </TableCell>

                      {/* Reservation and Payment Status */}
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="outline" className={`text-xs capitalize ${getStatusColor(displayStatus)}`}>
                            {capitalize(displayStatus)}
                          </Badge>
                          {(!grouped || !samePayment) && renderPaymentBadge(booking)}
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

                              <DropdownMenuItem onClick={() => setDetailsId(booking.id)} className="cursor-pointer text-xs font-semibold">
                                <PanelRight className="mr-2 h-4 w-4" />
                                Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setHistoryBooking(booking)} className="cursor-pointer text-xs font-semibold">
                                <History className="mr-2 h-4 w-4" />
                                History
                              </DropdownMenuItem>
                              {actionsFor(booking).map((action) => (
                                <Fragment key={action.key}>
                                  {action.destructive && <DropdownMenuSeparator />}
                                  <DropdownMenuItem
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    title={action.title}
                                    className={`cursor-pointer text-xs font-semibold ${action.tone ?? ""}`}
                                  >
                                    <action.icon className={`mr-2 h-4 w-4 ${action.icon === Loader2 ? "animate-spin" : ""}`} />
                                    {action.label}
                                  </DropdownMenuItem>
                                </Fragment>
                              ))}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                    }),
                  ];
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

      <BookingDetailsSheet
        booking={detailsBooking}
        status={detailsBooking ? capitalize(getBookingDisplayStatus(detailsBooking)) : ""}
        statusClass={detailsBooking ? getStatusColor(getBookingDisplayStatus(detailsBooking)) : ""}
        actions={detailsBooking ? actionsFor(detailsBooking) : []}
        onClose={() => setDetailsId(null)}
      />

    </>
  );
}