"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { UserBooking, fetchUserBookings } from "@/lib/services/bookings/fetchUserBookings.service";
import { Calendar, Clock, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const BookingHistoryContainer = () => {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");

  useEffect(() => {
    const loadBookings = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await fetchUserBookings(user.id);
        if (data) setBookings(data);
      }
      setLoading(false);
    };
    loadBookings();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground text-sm">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Loading your bookings...
      </div>
    );
  }

  const now = new Date();

  // Split bookings into upcoming and past
  const upcomingBookings = bookings.filter((b) => {
    const bookingDateTime = new Date(`${b.booking_date}T${b.start_time}`);
    return bookingDateTime >= now;
  });

  const pastBookings = bookings.filter((b) => {
    const bookingDateTime = new Date(`${b.booking_date}T${b.start_time}`);
    return bookingDateTime < now;
  });

  const displayedBookings = activeTab === "upcoming" ? upcomingBookings : pastBookings;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
      <div>
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
        {displayedBookings.length === 0 ? (
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
                className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center p-5 rounded-2xl border bg-card shadow-sm hover:shadow-md transition-all group"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                      {booking.courts?.name || `Court ${booking.court_id}`}
                    </Badge>
                    <Badge variant={booking.status === "confirmed" || booking.status === "paid" ? "default" : "secondary"}>
                      {booking.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm">
                    <div className="flex items-center gap-1.5 text-foreground font-medium">
                      <Calendar className="size-4 text-muted-foreground" />
                      {new Date(booking.booking_date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric"
                      })}
                    </div>
                    <div className="flex items-center gap-1.5 text-foreground font-medium">
                      <Clock className="size-4 text-muted-foreground" />
                      {booking.start_time} - {booking.end_time}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-start sm:items-end w-full sm:w-auto mt-2 sm:mt-0">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Total Paid</span>
                  <span className="text-xl font-bold">
                    {booking.amount ? `₱${booking.amount.toLocaleString()}` : "₱---"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
