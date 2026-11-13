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
            <ol aria-label="How to book a court" className="mb-8 grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-3 sm:p-5">
              {[
                ["Pick your session", "Court, date & time"],
                ["Your details", "Sign in or book as a guest"],
                ["Pay with QR Ph", "Confirmed once payment is received"],
              ].map(([title, hint], i) => (
                <li key={title} className="flex items-center gap-3">
                  <span
                    className="step-light size-9 shrink-0 rounded-[10px] grid place-items-center font-display font-bold text-sm bg-muted text-muted-foreground"
                    style={{ "--step-delay": `${i * 1.2}s` } as React.CSSProperties}
                  >
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{title}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </li>
              ))}
            </ol>
            <BookingContainer />
          </div>
        </section>
      </main>
    </div>
  );
}
