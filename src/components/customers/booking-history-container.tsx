"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserBooking, fetchUserBookings } from "@/lib/services/bookings/fetchUserBookings.service";
import { cancelBooking, isBookingCancellable } from "@/lib/services/bookings/cancelBooking.service";
import { formatTime12h } from "@/lib/utils/formatTime";
import {
  Calendar,
  Clock,
  LoaderCircle,
  ArrowLeft,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  CalendarDays,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const formatBookingDate = (date: string) =>
  new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** Loads the current user's bookings. Returns null if unauthenticated or the fetch failed. */
const fetchCurrentUserBookings = async (): Promise<UserBooking[] | null> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await fetchUserBookings(user.id);
  return error ? null : data;
};

export const BookingHistoryContainer = () => {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");
  const [bookingToCancel, setBookingToCancel] = useState<UserBooking | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // Synchronous guard against double submission (state updates are not visible until re-render).
  const cancelInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    fetchCurrentUserBookings().then((data) => {
      if (!active) return;
      if (data) setBookings(data);
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
      if (latest) setBookings(latest);
    } else {
      // Apply the status confirmed by the backend.
      setBookings((prev) =>
        prev.map((booking) =>
          booking.id === data.id ? { ...booking, status: data.status } : booking
        )
      );
      toast.success("Court reservation cancelled successfully.");
    }

    setCancellingId(null);
    setBookingToCancel(null);
    cancelInFlight.current = false;
  };

  const now = new Date();

  // Split bookings into upcoming and past
  const upcomingBookings = bookings.filter((booking) => {
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.start_time}`);
    return bookingDateTime >= now;
  });

  const pastBookings = bookings.filter((booking) => {
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.start_time}`);
    return bookingDateTime < now;
  });

  const displayedBookings = activeTab === "upcoming" ? upcomingBookings : pastBookings;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
      {/* Page Header */}
      <div>
        <Link href="/">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 gap-2 -ml-2 text-muted-foreground hover:text-foreground text-xs sm:text-sm font-medium"
          >
            <ArrowLeft className="size-4" />
            Back to Courts
          </Button>
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          My Court Reservations
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base mt-1.5 leading-relaxed">
          View your upcoming match passes, check reservation status, and review past court sessions.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b pb-4 overflow-x-auto whitespace-nowrap">
        <Button
          variant={activeTab === "upcoming" ? "default" : "ghost"}
          onClick={() => setActiveTab("upcoming")}
          className="rounded-full px-5 text-xs sm:text-sm font-semibold transition-all"
        >
          Upcoming Matches ({upcomingBookings.length})
        </Button>
        <Button
          variant={activeTab === "past" ? "default" : "ghost"}
          onClick={() => setActiveTab("past")}
          className="rounded-full px-5 text-xs sm:text-sm font-semibold transition-all"
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
                  className={`flex flex-col sm:flex-row gap-5 justify-between items-start sm:items-center p-5 sm:p-6 rounded-2xl border bg-card shadow-xs hover:shadow-md transition-all ${
                    booking.status === "cancelled" ? "opacity-60 bg-muted/20" : ""
                  }`}
                >
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
                      ) : booking.status === "pending" ? (
                        <Badge
                          variant="outline"
                          className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-semibold text-xs gap-1"
                        >
                          <Clock className="size-3" />
                          PENDING PAYMENT
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-muted text-muted-foreground border-border font-semibold text-xs gap-1"
                        >
                          <XCircle className="size-3" />
                          CANCELLED
                        </Badge>
                      )}
                    </div>

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
                      <span>Crosshair Dinkers Complex, J.C. Aquino Ave, Butuan City</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start sm:items-end w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-border/60">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                      Court Rate
                    </span>
                    <span className="text-2xl font-black text-foreground">
                      {booking.total_amount ? `₱${booking.total_amount.toLocaleString()}` : "₱---"}
                    </span>

                    {cancellable && (
                      <Button
                        id={`cancel-booking-${booking.id}`}
                        variant="outline"
                        size="sm"
                        className="mt-3 gap-1.5 w-full sm:w-auto text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive font-semibold text-xs"
                        onClick={() => setBookingToCancel(booking)}
                        disabled={cancellingId !== null}
                      >
                        {cancellingId === booking.id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <XCircle className="size-3.5" />
                        )}
                        {cancellingId === booking.id ? "Cancelling..." : "Cancel Reservation"}
                      </Button>
                    )}
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

          {bookingToCancel?.status === "confirmed" && (
            <div className="flex items-start gap-2.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg leading-relaxed">
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p>
                Payments and court credits are handled directly by venue management. Please contact Crosshair Dinkers reception (+63 917 123 4567) regarding your refund.
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
