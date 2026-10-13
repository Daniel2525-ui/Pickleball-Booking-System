"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserBooking, fetchUserBookings } from "@/lib/services/bookings/fetchUserBookings.service";
import { cancelBooking, isBookingCancellable } from "@/lib/services/bookings/cancelBooking.service";
import { formatTime12h } from "@/lib/utils/formatTime";
import { Calendar, Clock, LoaderCircle, ArrowLeft, XCircle, AlertTriangle } from "lucide-react";
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
    year: "numeric"
  });

/** Loads the current user's bookings. Returns null if unauthenticated or the fetch failed. */
const fetchCurrentUserBookings = async (): Promise<UserBooking[] | null> => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
      toast.error(error?.message || "Failed to cancel booking. Please try again.");
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
      toast.success("Booking cancelled successfully");
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
      <div>
        <Link href="/">
          <Button variant="ghost" size="sm" className="mb-6 gap-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Back to Home
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">My Bookings</h1>
        <p className="text-muted-foreground mt-2">
          View your upcoming sessions and past booking history.
        </p>
      </div>

      <div className="flex items-center gap-4 border-b pb-4 overflow-x-auto whitespace-nowrap">
        <Button
          variant={activeTab === "upcoming" ? "default" : "ghost"}
          onClick={() => setActiveTab("upcoming")}
          className="rounded-full px-6"
        >
          Upcoming ({upcomingBookings.length})
        </Button>
        <Button
          variant={activeTab === "past" ? "default" : "ghost"}
          onClick={() => setActiveTab("past")}
          className="rounded-full px-6"
        >
          Past ({pastBookings.length})
        </Button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <BookingCardSkeleton key={i} />
            ))}
          </div>
        ) : displayedBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-2xl bg-muted/20 border-dashed">
            <Calendar className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No bookings found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {activeTab === "upcoming"
                ? "You don't have any upcoming court reservations. Time to play?"
                : "You haven't played any sessions yet."}
            </p>
            {activeTab === "upcoming" && (

              <Button className="mt-6 rounded-full shadow-lg hover:shadow-xl transition-all">
                <a href="/">Book a Court Now</a>
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {displayedBookings.map((booking) => (
              <div
                key={booking.id}
                className={`flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center p-5 rounded-2xl border bg-card shadow-sm hover:shadow-md transition-all group ${booking.status === "cancelled" ? "opacity-70" : ""}`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                      {booking.courts?.name || `Court ${booking.court_id}`}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        booking.status === "confirmed" || booking.status === "paid"
                          ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/50"
                          : booking.status === "pending"
                            ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-amber-200 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/50"
                            : "bg-red-500/15 text-red-700 hover:bg-red-500/25 border-red-200 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/50"
                      }
                    >
                      {booking.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm">
                    <div className="flex items-center gap-1.5 text-foreground font-medium">
                      <Calendar className="size-4 text-muted-foreground" />
                      {formatBookingDate(booking.booking_date)}
                    </div>
                    <div className="flex items-center gap-1.5 text-foreground font-medium">
                      <Clock className="size-4 text-muted-foreground" />
                      {formatTime12h(booking.start_time)} - {formatTime12h(booking.end_time)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-start sm:items-end w-full sm:w-auto mt-2 sm:mt-0">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Total Paid</span>
                  <span className="text-xl font-bold">
                    {booking.total_amount ? `₱${booking.total_amount.toLocaleString()}` : "₱---"}
                  </span>
                  {isBookingCancellable(booking) && (
                    <Button
                      id={`cancel-booking-${booking.id}`}
                      variant="destructive"
                      size="sm"
                      className="mt-3 gap-1.5 w-full sm:w-auto"
                      onClick={() => setBookingToCancel(booking)}
                      disabled={cancellingId !== null}
                    >
                      {cancellingId === booking.id ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <XCircle className="size-3.5" />
                      )}
                      {cancellingId === booking.id ? "Cancelling..." : "Cancel Booking"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={bookingToCancel !== null}
        onOpenChange={(open) => {
          // Keep the dialog open while the request is in flight.
          if (!open && !cancellingId) setBookingToCancel(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!cancellingId}>
          <DialogHeader>
            <DialogTitle>Cancel this booking?</DialogTitle>
            <DialogDescription>
              This will release your court reservation. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {bookingToCancel && (
            <div className="bg-muted p-4 rounded-xl space-y-2">
              <p className="font-semibold">
                {bookingToCancel.courts?.name || `Court ${bookingToCancel.court_id}`}
              </p>
              <div className="flex items-center text-sm text-muted-foreground gap-1.5">
                <Calendar className="size-3.5" />
                {formatBookingDate(bookingToCancel.booking_date)}
              </div>
              <div className="flex items-center text-sm text-muted-foreground gap-1.5">
                <Clock className="size-3.5" />
                {formatTime12h(bookingToCancel.start_time)} - {formatTime12h(bookingToCancel.end_time)}
              </div>
            </div>
          )}

          {bookingToCancel?.status === "confirmed" && (
            <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 p-3 rounded-md">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <p>Refunds are not processed automatically. Please contact the venue regarding any refund.</p>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              id="cancel-booking-dismiss"
              variant="outline"
              onClick={() => setBookingToCancel(null)}
              disabled={cancellingId !== null}
              className="w-full sm:w-auto"
            >
              Keep Booking
            </Button>
            <Button
              id="cancel-booking-confirm"
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={cancellingId !== null}
              className="w-full sm:w-auto gap-2"
            >
              {cancellingId ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              {cancellingId ? "Cancelling..." : "Yes, Cancel Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
