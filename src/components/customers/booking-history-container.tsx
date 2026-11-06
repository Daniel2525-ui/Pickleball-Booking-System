"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserBooking, fetchUserBookings } from "@/lib/services/bookings/fetchUserBookings.service";
import { useVenueContact } from "@/hooks/use-venue-contact";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { cancelBooking, isBookingCancellable } from "@/lib/services/bookings/cancelBooking.service";
import { DEFAULT_POLICY, fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";
import { getBookingStart } from "@/lib/utils/bookingTime";
import { cancellationNote, getBookingDisplayStatus, isAwaitingVerification } from "@/lib/services/bookings/bookingDisplayStatus";
import { checkoutTotal, groupByCheckout, isLive, pendingBasketSize, settleHold } from "@/lib/services/bookings/basket";

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
import { Button, buttonVariants } from "@/components/ui/button";
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
import { bookingTitle, bookingRef } from "@/lib/services/openPlay/bookingTitle";

// Notes that need the player's attention read amber
const noteTone = (text: string) =>
  /Cancelled by the venue|Refund failed|Refund delayed/.test(text) ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground";

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

/** Loads the current user's bookings and authentication state; `failed` when the bookings could not be read. */
const fetchCurrentUserBookings = async (): Promise<{ bookings: UserBooking[]; isAuthenticated: boolean; failed: boolean }> => {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { bookings: [], isAuthenticated: false, failed: false };
    const { data, error } = await fetchUserBookings(user.id);
    return { bookings: data || [], isAuthenticated: true, failed: Boolean(error) };
  } catch {
    return { bookings: [], isAuthenticated: true, failed: true };
  }
};

export const BookingHistoryContainer = () => {
  const venue = useVenueContact();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  // The venue's online cancellation cutoff (Settings); the cancel route enforces the same value
  const [cancelCutoffHours, setCancelCutoffHours] = useState(DEFAULT_POLICY.cancelCutoffHours);
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
      // Re-sync with the database to reflect any status changes (a failed read keeps what is shown)
      const latest = await fetchCurrentUserBookings();
      if (!latest.failed) setBookings(latest.bookings);
    } else {
      toast.success("Redirecting to payment...", { id: "resume-payment-toast" });
      window.location.assign(url);
    }
  };

  useEffect(() => {
    let active = true;
    fetchBookingPolicy(createClient()).then((p) => active && setCancelCutoffHours(p.cancelCutoffHours));
    fetchCurrentUserBookings().then((res) => {
      if (!active) return;
      setIsAuthenticated(res.isAuthenticated);
      setBookings(res.bookings);
      setLoadFailed(res.failed);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  // Staff approving a GCash payment or cancelling shows up without a reload (realtime only sends this player's rows)
  useLiveRefresh(() => fetchCurrentUserBookings().then((latest) => !latest.failed && setBookings(latest.bookings)));

  const handleConfirmCancel = async () => {
    if (!bookingToCancel || cancelInFlight.current) return;
    cancelInFlight.current = true;

    const targetId = bookingToCancel.id;
    setCancellingId(targetId);

    const { data, error } = await cancelBooking(targetId);

    if (error || !data) {
      toast.error(error?.message || "Failed to cancel reservation. Please try again.");
      // Re-sync with the database so the UI reflects the booking's real status (a failed read keeps what is shown).
      const latest = await fetchCurrentUserBookings();
      if (!latest.failed) setBookings(latest.bookings);
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
        manual: `Venue staff will refund your payment; questions? Call ${venue.phone}.`,
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

  const isUpcoming = (b: UserBooking) => isLive(b) && getBookingStart(b) >= now;
  const nextStart = (g: UserBooking[]) => Math.min(...g.filter(isUpcoming).map((b) => getBookingStart(b).getTime()));

  // One card per checkout; it stays Upcoming until its last court starts.
  // Upcoming reads soonest first (the next game on top); past keeps the newest-first order the query returns
  const groups = groupByCheckout(bookings);
  const upcomingBookings = groups.filter((g) => g.some(isUpcoming)).sort((a, b) => nextStart(a) - nextStart(b));
  const pastBookings = groups.filter((g) => !g.some(isUpcoming));

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
          aria-pressed={activeTab === "upcoming"}
          onClick={() => setActiveTab("upcoming")}
          className="rounded-full px-5 min-h-[44px] text-xs sm:text-sm font-semibold transition-all shrink-0"
        >
          {/* Short labels on phones so both tabs fit a 320px screen */}
          Upcoming<span className="hidden sm:inline"> Matches</span> ({upcomingBookings.length})
        </Button>
        <Button
          variant={activeTab === "past" ? "default" : "ghost"}
          aria-pressed={activeTab === "past"}
          onClick={() => setActiveTab("past")}
          className="rounded-full px-5 min-h-[44px] text-xs sm:text-sm font-semibold transition-all shrink-0"
        >
          Past<span className="hidden sm:inline"> Sessions</span> ({pastBookings.length})
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
            <h2 className="text-lg font-bold text-foreground">Sign In Required</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
              Please sign in to your account to view your court reservations and match passes.
            </p>
            <Link href="/login" className={buttonVariants({ className: "mt-6 rounded-xl shadow-md hover:shadow-lg font-bold gap-2" })}>
              Sign In to View Reservations
            </Link>
          </div>
        ) : loadFailed ? (
          <div role="alert" className="flex flex-col items-center justify-center py-16 text-center border rounded-2xl border-destructive/40 bg-destructive/5 p-6">
            <AlertTriangle className="size-6 text-destructive mb-3" />
            <h2 className="text-lg font-bold text-foreground">Couldn&apos;t load your bookings</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
              Your reservations are safe. Refresh the page to try again, or call {venue.phone}.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()} className="mt-6 min-h-[44px] font-bold">
              Refresh
            </Button>
          </div>
        ) : displayedBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-2xl bg-muted/20 border-dashed p-6">
            <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
              <Calendar className="size-6" />
            </div>
            <h2 className="text-lg font-bold text-foreground">
              {activeTab === "upcoming" ? "No Upcoming Reservations" : "No Past Match History"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
              {activeTab === "upcoming"
                ? "You don't have any courts booked right now. Ready to play some pickleball?"
                : "Completed matches and past session records will be archived here."}
            </p>
            {activeTab === "upcoming" && (
              <Link href="/#booking" className={buttonVariants({ className: "mt-6 rounded-xl shadow-md hover:shadow-lg font-bold gap-2" })}>
                <CalendarDays className="size-4" />
                Reserve a Court Now
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {displayedBookings.map((group) => {
              // The card speaks for its first live court (the first court once all are cancelled)
              const booking = group.find(isLive) ?? group[0];
              const multi = group.length > 1;
              const live = group.filter(isLive);
              const shown = live.length ? live : group;
              const cancellable = isBookingCancellable(booking, new Date(), cancelCutoffHours);
              const lineCancellable = (m: UserBooking) => booking.status !== "pending" && isBookingCancellable(m, new Date(), cancelCutoffHours);
              const note = cancellationNote(booking);

              return (
                <div
                  key={booking.basket_id ?? booking.id}
                  // Cancelled cards sit back through the surface, not opacity, so their text keeps full contrast
                  className={`grid grid-cols-[minmax(0,1fr)_76px] sm:grid-cols-[minmax(0,1fr)_96px] rounded-2xl border overflow-hidden ${booking.status === "pending" ? "border-amber-500/60" : ""} ${note ? "bg-muted/30 border-dashed" : "bg-card"}`}
                >
                <div className="flex flex-col sm:flex-row gap-5 justify-between items-start sm:items-center p-5 sm:p-6 min-w-0">
                  <div className={`space-y-3.5 ${multi ? "w-full min-w-0 sm:flex-1" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="bg-primary/10 text-primary border-primary/25 font-bold text-xs px-2.5 py-0.5"
                      >
                        {multi ? `${group.length} COURTS` : bookingTitle(booking)}
                      </Badge>
                      {!multi && <span className="font-mono text-xs text-muted-foreground">Ref {bookingRef(booking.id)}</span>}

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
                            setBookings((prev) => settleHold(prev, booking, newStatus, cancelReason));
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

                    {note && !multi && (
                      <p className={`text-xs font-semibold ${noteTone(note.text)}`}>
                        {note.text}
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
                          {/* Times are HH:MM:SS, so the earliest/latest sort as strings */}
                          {formatTime12h(shown.map((m) => m.start_time).sort()[0])} – {formatTime12h(shown.map((m) => m.end_time).sort().at(-1)!)}
                        </span>
                      </div>
                    </div>

                    {multi && (
                      <ul aria-label="Courts in this booking" className="divide-y rounded-xl border">
                        {[...group].sort((a, b) => a.start_time.localeCompare(b.start_time) || bookingTitle(a).localeCompare(bookingTitle(b))).map((m) => {
                          const mNote = isLive(m) ? null : cancellationNote(m);
                          return (
                            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
                              <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                                <p className={`text-sm font-black ${isLive(m) ? "text-foreground" : "text-muted-foreground"}`}>
                                  {bookingTitle(m)}
                                  {!isLive(m) && (
                                    <Badge variant="outline" className="ml-2 bg-muted text-muted-foreground border-border font-semibold text-[10px]">
                                      {HISTORY_LABELS[m.status] ?? m.status.toUpperCase()}
                                    </Badge>
                                  )}
                                </p>
                                <p className={`text-xs font-bold ${isLive(m) ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                                  {formatTime12h(m.start_time)} – {formatTime12h(m.end_time)}
                                </p>
                                <p className="font-mono text-[11px] text-muted-foreground">Ref {bookingRef(m.id)}</p>
                                {mNote && <p className={`text-xs font-semibold ${noteTone(mNote.text)}`}>{mNote.text}</p>}
                              </div>
                              <span className={`ml-auto text-sm font-black tabular-nums ${isLive(m) ? "text-foreground" : "text-muted-foreground line-through"}`}>
                                ₱{Number(m.total_amount ?? 0).toLocaleString()}
                              </span>
                              {lineCancellable(m) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label={`Cancel ${bookingTitle(m)}`}
                                  className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive font-semibold text-xs min-h-[44px] sm:min-h-[32px]"
                                  onClick={() => setBookingToCancel(m)}
                                  disabled={cancellingId !== null || resumingId !== null}
                                >
                                  {cancellingId === m.id ? <LoaderCircle className="size-3.5 animate-spin" /> : "Cancel"}
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5 text-muted-foreground/80 shrink-0" />
                      <span>Crosshair Dinkers Complex, {venue.address}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start sm:items-end w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-border/60">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                      Total{multi && (live.length < group.length ? ` · ${live.length} of ${group.length} courts` : ` · ${group.length} courts`)}
                    </span>
                    {/* Never charged (expired or abandoned hold): the price stays visible but reads as not paid */}
                    <span className={`text-2xl font-black ${note && !note.charged ? "text-muted-foreground line-through decoration-2" : "text-foreground"}`}>
                      {checkoutTotal(group) ? `₱${checkoutTotal(group).toLocaleString()}` : "₱---"}
                    </span>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-3 w-full sm:w-auto">
                      {/* A submitted GCash payment waits on staff; there is nothing left to pay */}
                      {booking.status === "pending" && !isAwaitingVerification(booking) && (
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

                      {/* A paid checkout cancels court by court (lines above); an unpaid one only as a whole */}
                      {cancellable && (!multi || booking.status === "pending") && (
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

                      {!cancellable && !group.some(lineCancellable) && booking.status === "confirmed" && getBookingStart(booking) > new Date() && (
                        <p className="text-[11px] text-muted-foreground sm:text-right max-w-[220px]">
                          Online cancellation closes {cancelCutoffHours} hours before start. Need help? Call{" "}
                          <a href={venue.phoneHref} className="font-semibold text-foreground hover:underline">
                            {venue.phone}
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
                {bookingTitle(bookingToCancel)}
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
                You&apos;ll get a full refund. Card payments go back to your card automatically (banks usually take 5–10 business days to show it); counter payments are refunded by venue staff. Questions? Call {venue.phone}.
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
