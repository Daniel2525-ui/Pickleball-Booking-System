import { BookingHistoryContainer } from "@/components/customers/booking-history-container";
import { PublicHeader } from "@/components/customers/public-header";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "My Reservations | Crosshair Dinkers",
  description: "View your upcoming and past pickleball court reservations at Crosshair Dinkers Butuan City.",
};

export default function MyBookingsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <PublicHeader />
      {/* Phones: the back link opens the page right under the header, so no extra top padding before it */}
      <main className="flex-1 pt-3 pb-8 sm:py-12">
        {/* Phones hide the header's Book link, so give them a way back */}
        <div className="max-w-4xl mx-auto px-4 sm:hidden">
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 gap-2 min-h-[44px] px-3 text-muted-foreground hover:text-foreground" })}>
            <ArrowLeft className="size-4" />
            Back to courts
          </Link>
        </div>
        <BookingHistoryContainer />
      </main>
    </div>
  );
}
