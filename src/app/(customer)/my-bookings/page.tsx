import { BookingHistoryContainer } from "@/components/customers/booking-history-container";
import { PublicHeader } from "@/components/customers/public-header";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Reservations | Crosshair Dinkers",
  description: "View your upcoming and past pickleball court reservations at Crosshair Dinkers Butuan City.",
};

export default function MyBookingsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <PublicHeader />
      <main className="flex-1 py-8 sm:py-12">
        <BookingHistoryContainer />
      </main>
    </div>
  );
}
