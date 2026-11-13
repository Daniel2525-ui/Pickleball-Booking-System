import { Metadata } from "next";
import { PublicHeader } from "@/components/customers/public-header";
import { PublicFooter } from "@/components/customers/public-footer";
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
            <ol aria-label="How to book a court" className="mb-8 grid gap-6 sm:gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-3 sm:p-5">
              {[
                ["Pick your session", "Court, date & time"],
                ["Your details", "Sign in or book as a guest"],
                ["Pay with QR Ph", "Confirmed once payment is received"],
              ].map(([title, hint], i) => (
                <li key={title} className="relative flex items-start sm:items-center gap-3" style={{ "--step-delay": `${i * 1.2}s` } as React.CSSProperties}>
                  <span className="step-light size-9 shrink-0 rounded-[10px] grid place-items-center font-display font-bold text-sm bg-muted text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{title}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                  {/* Connector to the next step; it fills as the light passes along */}
                  {i < 2 && (
                    <>
                      <span aria-hidden className="hidden sm:block h-0.5 min-w-6 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className="step-line block h-full origin-left bg-primary" />
                      </span>
                      {/* Stacked on phones: runs down from this step's number to the next one */}
                      <span aria-hidden className="sm:hidden absolute left-[17px] top-9 -bottom-6 w-0.5 overflow-hidden bg-muted">
                        <span className="step-line step-line-down block size-full origin-top bg-primary" />
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
            <BookingContainer />
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
