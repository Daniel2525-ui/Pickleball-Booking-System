import { fetchVenueContact } from "@/lib/venue";
import Link from "next/link";
import { Crosshair, MapPin, Phone, Mail } from "lucide-react";
import { BookingContainer } from "@/components/customers/booking-container";
import { PublicHeader } from "@/components/customers/public-header";
import { FAQSection } from "@/components/customers/faq-section";
import { getPublicClient } from "@/lib/supabase/public";
import { summarizeVenueHours } from "@/lib/utils/venueHours";
import { fetchPricing } from "@/lib/services/pricing/fetchPricing.service";
import { lowestHourlyRate } from "@/lib/services/pricing/quoteCourtPrice";
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";

// Hours, courts and pricing are edited in the admin; refresh the static page at most every 5 minutes
export const revalidate = 300;

export default async function Home() {
  // Anonymous read of public tables (same access the guest booking grid uses)
  const supabase = getPublicClient();
  const [{ data: operatingHours }, { count: courtCount }, { data: pricing }] = await Promise.all([
    supabase.from("operating_hours").select("day_of_week, is_open, open_time, close_time"),
    supabase.from("courts").select("id", { count: "exact", head: true }),
    fetchPricing(supabase),
  ]);
  const { cancelCutoffHours } = await fetchBookingPolicy(supabase);
  const venue = await fetchVenueContact(supabase);
  const hours = summarizeVenueHours(operatingHours ?? []);
  const fromRate = pricing ? lowestHourlyRate(pricing) : null;

  const stats = [
    { value: courtCount ? String(courtCount) : "—", label: "regulation courts, 44 × 20 ft" },
    { value: fromRate ? `₱${fromRate.toLocaleString()}` : "—", label: "per court, per hour. Paddles and balls included" },
    { value: `${cancelCutoffHours} hrs`, label: "before play: cancel online for a full refund" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-primary/20 selection:text-primary">
      <PublicHeader />

      <main className="flex-1 flex flex-col">
        <section id="booking" className="relative isolate scroll-mt-20 w-full pt-8 md:pt-12 pb-10">
          {/* Decorative: grid, slow spotlight and two light beams behind the hero (styles in globals.css) */}
          <div aria-hidden className="hero-backdrop">
            <div className="hero-spotlight" />
            <div className="hero-beam" style={{ left: "22%" }} />
            <div className="hero-beam" style={{ left: "64%", animationDelay: "2s" }} />
          </div>
          <div className="container mx-auto px-4 max-w-6xl w-full">
            <BookingContainer />
          </div>
        </section>

        <section aria-label="The venue" className="w-full border-t py-12 md:py-16">
          {/* Bento: each number in its own tile, the map in a tall tile beside them */}
          <div className="container mx-auto px-4 max-w-6xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)] gap-4">
            {stats.map((s, i) => (
              <div key={s.label} className={`rounded-2xl border bg-card p-5 ${i === 2 ? "sm:col-span-2 lg:col-start-1 lg:row-start-2" : ""}`}>
                <p className="font-display text-6xl font-black leading-none text-primary">{s.value}</p>
                <p className="mt-2 text-sm font-semibold text-muted-foreground max-w-[26ch]">{s.label}</p>
              </div>
            ))}

            <div id="location" className="rounded-2xl border bg-card p-5 scroll-mt-24 sm:col-span-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:row-span-2">
              {/* Keyless Google embed of the Settings address at city zoom.
                  shortcut: no exact pin until the venue has coordinates or a Google listing; switch the query then */}
              <iframe
                title={`Map of ${venue.address}`}
                src={`https://www.google.com/maps?q=${encodeURIComponent(venue.address)}&z=13&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block w-full aspect-[4/3] sm:aspect-[16/9] rounded-xl border bg-muted"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="size-4 text-primary shrink-0 mt-0.5" />
                  <span>{venue.address}</span>
                </p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-primary hover:underline underline-offset-4"
                >
                  Get directions<span className="sr-only"> (opens Google Maps)</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        <FAQSection />
      </main>

      <footer id="contact" className="border-t bg-card py-12 text-sm text-muted-foreground">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-display font-black text-xl uppercase text-foreground">
                <Crosshair className="size-5 text-primary" />
                <span>Crosshair Dinkers</span>
              </div>
              <p className="text-xs leading-relaxed max-w-xs">
                Butuan City&apos;s pickleball venue, open day and night.
              </p>
            </div>

            <div className="space-y-2.5">
              <h2 className="text-base text-foreground">Hours</h2>
              {hours ? (
                <ul className="text-xs space-y-0.5">
                  {hours.groups.map((g) => (
                    <li key={g.days} className="flex gap-2">
                      <span className="w-16 shrink-0 font-semibold text-foreground/80">{g.days}</span>
                      <span>{g.hours}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs">See the booking calendar for hours.</p>
              )}
              <p className="text-[11px] text-muted-foreground/80">Philippine Standard Time (Asia/Manila).</p>
            </div>

            <div className="space-y-2.5">
              <h2 className="text-base text-foreground">Find us</h2>
              <div className="space-y-1.5 text-xs">
                <p className="flex items-start gap-2">
                  <MapPin className="size-3.5 text-primary shrink-0 mt-0.5" />
                  <span>{venue.address}</span>
                </p>
                <p className="flex items-center gap-2">
                  <Phone className="size-3.5 text-primary" />
                  <a href={venue.phoneHref} className="hover:text-foreground transition-colors">{venue.phone}</a>
                </p>
                <p className="flex items-center gap-2">
                  <Mail className="size-3.5 text-primary" />
                  <a href={`mailto:${venue.email}`} className="hover:text-foreground transition-colors">{venue.email}</a>
                </p>
                <a href="#location" className="inline-block pt-1 font-bold text-primary hover:underline underline-offset-4">
                  Get directions
                </a>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground/80">
            <p>&copy; {new Date().getFullYear()} Crosshair Dinkers. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <Link href="/#faq" className="hover:text-foreground transition-colors">FAQ</Link>
              <span>•</span>
              <Link href="/terms#cancellation" className="hover:text-foreground transition-colors">Cancellation Policy</Link>
              <span>•</span>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
