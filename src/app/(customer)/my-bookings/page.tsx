import { BookingHistoryContainer } from "@/components/customers/booking-history-container";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Bookings | Pickleball Booking System",
  description: "View your upcoming and past pickleball court reservations.",
};

export default function MyBookingsPage() {
  return (
    <div className="min-h-screen bg-background pt-8 pb-12">
      <BookingHistoryContainer />
    </div>
  );
}
