import { fetchVenueContact } from "@/lib/venue";
import Link from "next/link";
import { Clock, MapPin, Phone, Mail } from "lucide-react";
import { PublicHeader } from "@/components/customers/public-header";
import { FAQSection } from "@/components/customers/faq-section";
import { CourtsShowcase } from "@/components/customers/courts-showcase";
import { getPublicClient } from "@/lib/supabase/public";
import { summarizeVenueHours } from "@/lib/utils/venueHours";
import { VENUE_CITY, VENUE_NAME, brandInitials } from "@/lib/brand";
import { CourtRally } from "@/components/court-lines";
import { OpenNowBadge, OpenNowText } from "@/components/customers/open-now-badge";

// Hours, courts and pricing are edited in the admin; refresh the static page at most every 5 minutes
export const revalidate = 300;

export default async function Home() {
  // Anonymous read of public tables (same access the guest booking grid uses)
  const supabase = getPublicClient();
  const [{ data: operatingHours }, { data: courtRows }] = await Promise.all([
    supabase.from("operating_hours").select("day_of_week, is_open, open_time, close_time"),
    supabase.from("courts").select("id, name, status, maintenance_note, photo_url, details").order("name"),
  ]);
  const venue = await fetchVenueContact(supabase);
  const hours = summarizeVenueHours(operatingHours ?? []);
  const courts = courtRows ?? [];
  const mapQuery = encodeURIComponent(`${VENUE_NAME}, ${venue.address}`);

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="flex-1 flex flex-col">
        <section aria-label={`Welcome to ${VENUE_NAME}`} className="relative isolate overflow-hidden border-b bg-primary text-primary-foreground">
          <div className="container mx-auto px-4 max-w-6xl py-12 md:py-16 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center">
            <div className="flex flex-col gap-5">
              <p className="text-sm font-bold uppercase tracking-[0.12em] opacity-85">{VENUE_NAME} · {VENUE_CITY}</p>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[0.98] tracking-tight text-balance">
                Book. Pay. Play.
              </h1>
              <p className="text-lg opacity-90 max-w-[42ch] leading-relaxed">
                Pick a court, pay with QR Ph, and you&apos;re confirmed.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/book" className="inline-flex min-h-12 items-center rounded-xl bg-primary-foreground px-6 text-base font-bold text-primary hover:opacity-90 transition-opacity">
                  Book a court
                </Link>
                <Link href="/open-play" className="inline-flex min-h-12 items-center rounded-xl border-[1.5px] border-current/60 px-5 text-base font-semibold hover:bg-primary-foreground/10 transition-colors">
                  Join open play
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <OpenNowBadge hours={operatingHours ?? []} />
              <CourtRally className="w-full h-auto" />
            </div>
          </div>
        </section>

        <section id="location" aria-labelledby="find-us" className="w-full scroll-mt-20 border-t py-12 md:py-16">
          <div className="container mx-auto px-4 max-w-6xl">
            <h2 id="find-us" className="text-3xl sm:text-4xl font-bold">Find us</h2>
            <p className="mt-2 text-muted-foreground">{venue.address}</p>
            <div className="mt-6 overflow-hidden rounded-2xl border bg-card flex flex-col lg:flex-row">
              {/* Keyless Google embed of the Settings address.
                  shortcut: no exact pin until the venue has coordinates or a Google listing; switch the query then */}
              <iframe
                title={`Map of ${VENUE_NAME}, ${venue.address}`}
                src={`https://www.google.com/maps?q=${mapQuery}&z=15&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block w-full lg:flex-[1.6] min-h-[320px] lg:min-h-[400px] border-0 bg-muted"
              />
              <div className="lg:flex-1 p-6 flex flex-col gap-5 border-t lg:border-t-0 lg:border-l">
                <div>
                  <p className="font-bold">{VENUE_NAME}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{venue.address}</p>
                </div>
                <ul className="flex flex-col gap-3 text-sm">
                  <li className="flex gap-2.5">
                    <Clock className="size-4.5 text-primary shrink-0" aria-hidden />
                    <OpenNowText hours={operatingHours ?? []} />
                  </li>
                  <li className="flex gap-2.5">
                    <Phone className="size-4.5 text-primary shrink-0" aria-hidden />
                    <a href={venue.phoneHref} className="hover:underline underline-offset-4">{venue.phone}</a>
                  </li>
                  <li className="flex gap-2.5">
                    <Mail className="size-4.5 text-primary shrink-0" aria-hidden />
                    <a href={`mailto:${venue.email}`} className="hover:underline underline-offset-4 break-all">{venue.email}</a>
                  </li>
                </ul>
                <div>
                  <h3 className="text-sm font-bold">Opening hours</h3>
                  {hours ? (
                    <ul className="mt-1 divide-y text-sm">
                      {hours.groups.map((g) => (
                        <li key={g.days} className="flex justify-between gap-4 py-2">
                          <span className="text-muted-foreground">{g.days}</span>
                          <span className="font-semibold text-right">{g.hours}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">See the booking calendar for hours.</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">Philippine time. Hours after midnight belong to the night before.</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <MapPin className="size-4" aria-hidden />
                    Google Maps<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <a
                    href={`https://waze.com/ul?q=${mapQuery}&navigate=yes`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex min-h-11 items-center justify-center rounded-xl border border-input px-4 text-sm font-semibold hover:bg-muted"
                  >
                    Waze<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <CourtsShowcase courts={courts} hours={operatingHours ?? []} />

        <FAQSection />
      </main>

      <footer id="contact" className="border-t bg-card py-10 text-sm text-muted-foreground">
        <div className="container mx-auto px-4 max-w-6xl flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="size-9 shrink-0 rounded-[10px] bg-primary text-primary-foreground grid place-items-center font-display font-bold text-sm">
              {brandInitials(VENUE_NAME)}
            </span>
            <div>
              <p className="font-display font-bold text-foreground">{VENUE_NAME}</p>
              <p className="text-xs">{VENUE_CITY}&apos;s pickleball courts</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <Link href="/#faq" className="hover:text-foreground transition-colors">FAQ</Link>
            <Link href="/terms#cancellation" className="hover:text-foreground transition-colors">Cancellation policy</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <span>&copy; {new Date().getFullYear()} {VENUE_NAME}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
