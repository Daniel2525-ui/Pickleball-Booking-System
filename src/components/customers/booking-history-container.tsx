"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserBooking, fetchUserBookings } from "@/lib/services/bookings/fetchUserBookings.service";
import { VENUE_CONTACT } from "@/lib/venue";
import { cancelBooking, isBookingCancellable, CANCELLATION_CUTOFF_HOURS } from "@/lib/services/bookings/cancelBooking.service";
import { getBookingStart } from "@/lib/utils/bookingTime";
import { getBookingDisplayStatus, isAwaitingVerification } from "@/lib/services/bookings/bookingDisplayStatus";
import { pendingBasketSize } from "@/lib/services/bookings/basket";

// Badges for bookings that are no longer awaiting payment or confirmed (EXPIRED = checkout timed out, nothing charged)
const HISTORY_LABELS: Record<string, string> = {
  expired: "EXPIRED",
  cancelled: "CANCELLED",
  no_show: "NO-SHOW",
  completed: "COMPLETED",
  checked_in: "CHECKED IN",
  awaiting_verification: "AWAITING VERIFICATION",
  in_progress: "IN PROGRESS",
};
import { formatTime12h } from "@/lib/utils/formatTime";
import {
  Calendar,
  Clock,
  LoaderCircle,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  CalendarDays,
  CreditCard,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resumeBookingPayment } from "@/lib/services/bookings/resumeBookingPayment.service";
import { BookingCountdown } from "@/components/customers/booking-countdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import { toast } from "sonner";
import { BookingCardSkeleton } from "@/components/skeletons/booking-card-skeleton";

const formatBookingDate = (date: string) => {
  const d = date.includes("T") ? new Date(date) : new Date(`${date}T12:00:00+08:00`);
  return d.toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/** Loads the current user's bookings and authentication state. */
const fetchCurrentUserBookings = async (): Promise<{ bookings: UserBooking[]; isAuthenticated: boolean }> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { bookings: [], isAuthenticated: false };
  const { data, error } = await fetchUserBookings(user.id);
  return { bookings: error ? [] : (data || []), isAuthenticated: true };
};

export const BookingHistoryContainer = () => {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");
  const [bookingToCancel, setBookingToCancel] = useState<UserBooking | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  // Synchronous guard against double submission (state updates are not visible until re-render).
  const cancelInFlight = useRef(false);

  const handleResumePayment = async (bookingId: string) => {
    if (resumingId || cancellingId) return;
    setResumingId(bookingId);
    toast.loading("Preparing checkout session...", { id: "resume-payment-toast" });

    const { url, error } = await resumeBookingPayment(bookingId);

    if (error || !url) {
      toast.error(error?.message || "Failed to resume payment. Please try again.", {
        id: "resume-payment-toast",
      });
      setResumingId(null);
      // Re-sync with the database to reflect any status changes
      const latest = await fetchCurrentUserBookings();
      if (latest) setBookings(latest.bookings);
    } else {
      toast.success("Redirecting to payment...", { id: "resume-payment-toast" });
      window.location.assign(url);
    }
  };

  useEffect(() => {
    let active = true;
    fetchCurrentUserBookings().then((res) => {
      if (!active) return;
      setIsAuthenticated(res.isAuthenticated);
      setBookings(res.bookings);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleConfirmCancel = async () => {
    if (!bookingToCancel || cancelInFlight.current) return;
    cancelInFlight.current = true;

    const targetId = bookingToCancel.id;
    setCancellingId(targetId);

    const { data, error } = await cancelBooking(targetId);

    if (error || !data) {
      toast.error(error?.message || "Failed to cancel reservation. Please try again.");
      // Re-sync with the database so the UI reflects the booking's real status.
      const latest = await fetchCurrentUserBookings();
      if (latest) setBookings(latest.bookings);
    } else {
      // Apply the status confirmed by the backend; the server also cancels every pending court of the same basket.
      setBookings((prev) =>
        prev.map((booking) =>
          booking.id === data.id ||
          (bookingToCancel.status === "pending" && bookingToCancel.basket_id && booking.status === "pending" && booking.basket_id === bookingToCancel.basket_id)
            ? { ...booking, status: data.status }
            : booking
        )
      );
      const refundMessage = {
        refunded: "Your full refund has been issued to your card.",
        queued: "Your full refund is being processed to your card.",
        manual: `Venue staff will refund your payment; questions? Call ${VENUE_CONTACT.phone}.`,
      } as const;
      toast.success(
        data.refund ? `Reservation cancelled. ${refundMessage[data.refund]}` : "Court reservation cancelled successfully."
      );
    }

    setCancellingId(null);
    setBookingToCancel(null);
    cancelInFlight.current = false;
  };

  // Split bookings into upcoming and past
  const now = new Date();

  const upcomingBookings = bookings.filter((booking) => {
    const isCancelledOrNoShow = booking.status === "cancelled" || booking.status === "no_show";
    return !isCancelledOrNoShow && getBookingStart(booking) >= now;
  });

  const pastBookings = bookings.filter((booking) => {
    const isCancelledOrNoShow = booking.status === "cancelled" || booking.status === "no_show";
    return isCancelledOrNoShow || getBookingStart(booking) < now;
  });

  const displayedBookings = activeTab === "upcoming" ? upcomingBookings : pastBookings;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-5xl sm:text-6xl leading-[0.9] text-foreground">
          My bookings
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base mt-1.5 leading-relaxed">
          View your upcoming match passes, check reservation status, and review past court sessions.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 sm:gap-3 border-b pb-4 overflow-x-auto whitespace-nowrap">
        <Button
          variant={activeTab === "upcoming" ? "default" : "ghost"}
          onClick={() => setActiveTab("upcoming")}
          className="rounded-full px-5 min-h-[44px] text-xs sm:text-sm font-semibold transition-all shrink-0"
        >
          Upcoming Matches ({upcomingBookings.length})
        </Button>
        <Button
          variant={activeTab === "past" ? "default" : "ghost"}
          onClick={() => setActiveTab("past")}
          className="rounded-full px-5 min-h-[44px] text-xs sm:text-sm font-semibold transition-all shrink-0"
        >
          Past Sessions ({pastBookings.length})
        </Button>
      </div>

      {/* Bookings List Area */}
      <div className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <BookingCardSkeleton key={i} />
            ))}
          </div>
        ) : !isAuthenticated ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-2xl bg-muted/20 border-dashed p-6">
            <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
              <Calendar className="size-6" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Sign In Required</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
              Please sign in to your account to view your court reservations and match passes.
            </p>
            <Link href="/login" className="mt-6">
              <Button className="rounded-xl shadow-md hover:shadow-lg font-bold gap-2">
                Sign In to View Reservations
              </Button>
            </Link>
          </div>
        ) : displayedBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-2xl bg-muted/20 border-dashed p-6">
            <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
              <Calendar className="size-6" />
            </div>
            <h3 className="text-lg font-bold text-foreground">
              {activeTab === "upcoming" ? "No Upcoming Reservations" : "No Past Match History"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
              {activeTab === "upcoming"
                ? "You don't have any courts booked right now. Ready to play some pickleball?"
                : "Completed matches and past session records will be archived here."}
            </p>
            {activeTab === "upcoming" && (
              <Link href="/#booking" className="mt-6">
                <Button className="rounded-xl shadow-md hover:shadow-lg font-bold gap-2">
                  <CalendarDays className="size-4" />
                  Reserve a Court Now
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {displayedBookings.map((booking) => {
              const cancellable = isBookingCancellable(booking);

              return (
                <div
                  key={booking.id}
                  className={`grid grid-cols-[minmax(0,1fr)_76px] sm:grid-cols-[minmax(0,1fr)_96px] rounded-2xl border bg-card overflow-hidden ${booking.status === "pending" ? "border-amber-500/60" : ""} ${booking.status === "cancelled" ? "opacity-60" : ""}`}
                >
                <div className="flex flex-col sm:flex-row gap-5 justify-between items-start sm:items-center p-5 sm:p-6 min-w-0">
                  <div className="space-y-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="bg-primary/10 text-primary border-primary/25 font-bold text-xs px-2.5 py-0.5"
                      >
                        {booking.courts?.name || `Court ${booking.court_id}`}
                      </Badge>

                      {booking.status === "confirmed" || booking.status === "paid" ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-semibold text-xs gap-1"
                        >
                          <CheckCircle2 className="size-3" />
                          CONFIRMED PASS
                        </Badge>
                      ) : isAwaitingVerification(booking) ? (
                        <Badge
                          variant="outline"
                          className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-semibold text-xs gap-1"
                        >
                          <Clock className="size-3" />
                          {HISTORY_LABELS.awaiting_verification}
                        </Badge>
                      ) : booking.status === "pending" ? (
                        <BookingCountdown
                          bookingId={booking.id}
                          holdExpiresAt={booking.hold_expires_at}
                          status={booking.status}
                          onStatusChange={(newStatus, cancelReason) => {
                            setBookings((prev) =>
                              prev.map((b) =>
                                b.id === booking.id ? { ...b, status: newStatus, cancel_reason: cancelReason } : b
                              )
                            );
                          }}
                        />
                      ) : (
                        (() => {
                          const shown = getBookingDisplayStatus(booking);
                          const played = shown === "completed" || shown === "checked_in" || shown === "in_progress";
                          return (
                            <Badge
                              variant="outline"
                              className={`${played ? "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20" : "bg-muted text-muted-foreground border-border"} font-semibold text-xs gap-1`}
                            >
                              {played ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                              {HISTORY_LABELS[shown] ?? shown.toUpperCase()}
                            </Badge>
                          );
                        })()
                      )}
                    </div>

                    {booking.status === "cancelled" && booking.cancel_reason === "gcash_rejected" && (
                      <p className="text-xs font-semibold text-muted-foreground">GCash payment could not be verified</p>
                    )}

                    {booking.status === "pending" && pendingBasketSize(bookings, booking) > 1 && (
                      <p className="text-xs font-semibold text-muted-foreground">
                        Part of a {pendingBasketSize(bookings, booking)}-court booking
                      </p>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm">
                      <div className="flex items-center gap-2 text-foreground font-semibold">
                        <Calendar className="size-4 text-primary shrink-0" />
                        <span>{formatBookingDate(booking.booking_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-foreground font-semibold">
                        <Clock className="size-4 text-primary shrink-0" />
                        <span>
                          {formatTime12h(booking.start_time)} – {formatTime12h(booking.end_time)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5 text-muted-foreground/80 shrink-0" />
                      <span>Crosshair Dinkers Complex, {VENUE_CONTACT.address}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start sm:items-end w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-border/60">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                      Court Rate
                    </span>
                    <span className="text-2xl font-black text-foreground">
                      {booking.total_amount ? `₱${booking.total_amount.toLocaleString()}` : "₱---"}
                    </span>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-3 w-full sm:w-auto">
                      {booking.status === "pending" && (
                        <Button
                          id={`resume-booking-${booking.id}`}
                          size="sm"
                          className="gap-1.5 shadow-sm hover:shadow font-bold text-xs bg-primary hover:bg-primary/90 text-primary-foreground min-h-[44px] sm:min-h-[36px] w-full sm:w-auto justify-center"
                          onClick={() => handleResumePayment(booking.id)}
                          disabled={resumingId === booking.id || cancellingId !== null}
                        >
                          {resumingId === booking.id ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <CreditCard className="size-3.5" />
                          )}
                          {resumingId === booking.id ? "Connecting..." : "Continue Payment"}
                        </Button>
                      )}

                      {cancellable && (
                        <Button
                          id={`cancel-booking-${booking.id}`}
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive font-semibold text-xs min-h-[44px] sm:min-h-[36px] w-full sm:w-auto justify-center"
                          onClick={() => setBookingToCancel(booking)}
                          disabled={cancellingId !== null || resumingId === booking.id}
                        >
                          {cancellingId === booking.id ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <XCircle className="size-3.5" />
                          )}
                          {cancellingId === booking.id ? "Cancelling..." : "Cancel Reservation"}
                        </Button>
                      )}

                      {!cancellable && booking.status === "confirmed" && getBookingStart(booking) > new Date() && (
                        <p className="text-[11px] text-muted-foreground sm:text-right max-w-[220px]">
                          Online cancellation closes {CANCELLATION_CUTOFF_HOURS} hours before start. Need help? Call{" "}
                          <a href={VENUE_CONTACT.phoneHref} className="font-semibold text-foreground hover:underline">
                            {VENUE_CONTACT.phone}
                          </a>
                          .
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {/* Ticket stub: the day at a glance */}
                <div className="border-l-2 border-dashed flex flex-col items-center justify-center gap-0.5 p-2 text-center" aria-hidden>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    {new Date(`${booking.booking_date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span className="font-display text-4xl font-black leading-none">{Number(booking.booking_date.slice(8, 10))}</span>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    {new Date(`${booking.booking_date}T00:00:00`).toLocaleDateString("en-US", { month: "short" })}
                  </span>
                </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cancellation Confirmation Dialog */}
      <Dialog
        open={bookingToCancel !== null}
        onOpenChange={(open) => {
          // Keep the dialog open while the request is in flight.
          if (!open && !cancellingId) setBookingToCancel(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!cancellingId}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Cancel Court Reservation?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              Are you sure you want to release this booking? Your reserved slot will immediately reopen for other players.
            </DialogDescription>
          </DialogHeader>

          {bookingToCancel && (
            <div className="bg-muted/50 border border-border p-4 rounded-xl space-y-2 text-sm">
              <p className="font-bold text-foreground">
                {bookingToCancel.courts?.name || `Court ${bookingToCancel.court_id}`}
              </p>
              <div className="flex items-center text-muted-foreground gap-2">
                <Calendar className="size-3.5 text-primary" />
                <span>{formatBookingDate(bookingToCancel.booking_date)}</span>
              </div>
              <div className="flex items-center text-muted-foreground gap-2">
                <Clock className="size-3.5 text-primary" />
                <span>
                  {formatTime12h(bookingToCancel.start_time)} – {formatTime12h(bookingToCancel.end_time)}
                </span>
              </div>
            </div>
          )}

          {bookingToCancel?.status === "pending" && pendingBasketSize(bookings, bookingToCancel) > 1 && (
            <p className="text-xs text-muted-foreground">
              This cancels all {pendingBasketSize(bookings, bookingToCancel)} courts in this unpaid booking.
            </p>
          )}

          {bookingToCancel?.status === "confirmed" && (
            <div className="flex items-start gap-2.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg leading-relaxed">
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p>
                You&apos;ll get a full refund. Card payments go back to your card automatically (banks usually take 5–10 business days to show it); counter payments are refunded by venue staff. Questions? Call {VENUE_CONTACT.phone}.
              </p>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
            <Button
              id="cancel-booking-dismiss"
              variant="outline"
              onClick={() => setBookingToCancel(null)}
              disabled={cancellingId !== null}
              className="w-full sm:w-auto"
            >
              Keep Reservation
            </Button>
            <Button
              id="cancel-booking-confirm"
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={cancellingId !== null}
              className="w-full sm:w-auto gap-2 font-semibold"
            >
              {cancellingId ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              {cancellingId ? "Cancelling..." : "Yes, Cancel Reservation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
