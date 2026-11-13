import { Metadata } from "next";
import { PublicHeader } from "@/components/customers/public-header";
import { BookingContainer } from "@/components/customers/booking-container";
import { VENUE_NAME, VENUE_CITY } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Book a court",
  description: `Pick a date, court and time at ${VENUE_NAME} ${VENUE_CITY}, then pay with QR Ph.`,
};

export default function BookPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <PublicHeader />
      <main className="flex-1">
        <section id="booking" aria-label="Book a court" className="w-full py-8 sm:py-12">
          <div className="container mx-auto px-4 max-w-7xl w-full">
            <BookingContainer />
          </div>
        </section>
      </main>
    </div>
  );
}
