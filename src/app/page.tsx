import Image from "next/image";
import Link from "next/link";
import {
  Crosshair,
  MapPin,
  Clock,
  CheckCircle2,
  Phone,
  Mail,
  Layers,
  SunMedium,
  Award,
  CalendarDays,
} from "lucide-react";
import { BookingContainer } from "@/components/customers/booking-container";
import { PublicHeader } from "@/components/customers/public-header";
import { FAQSection } from "@/components/customers/faq-section";
import { HeroSection } from "@/components/customers/hero-section";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-primary/20 selection:text-primary">
      <PublicHeader />

      <main className="flex-1 flex flex-col">
        {/* Animated Hero Section */}
        <HeroSection />

        {/* 3-Step How It Works Section */}
        <section
          id="how-it-works"
          className="scroll-mt-20 w-full py-16 md:py-24 border-t bg-muted/15"
        >
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="text-center max-w-3xl mx-auto mb-16 md:mb-20">
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight mb-4 text-foreground">
                How Booking Works
              </h2>
              <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
                No phone calls, no waiting for replies. Check live availability and secure your court in three simple steps.
              </p>
            </div>

            <div className="relative">
              {/* Underlying Connecting Track on Desktop */}
              <div className="hidden md:block absolute top-12 left-[18%] right-[18%] h-[2px] border-t-2 border-dashed border-border/80 -z-0 pointer-events-none" />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 relative z-10">
                {/* Step 1 */}
                <div className="bg-card border border-border/80 rounded-2xl p-6 md:p-8 flex flex-col relative shadow-xs hover:-translate-y-1.5 hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                  <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 text-primary font-black text-xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all duration-200 shadow-2xs">
                    01
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-foreground group-hover:text-primary transition-colors">
                    Pick Your Date
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                    Select your desired playing day on our live operational calendar. View exact opening hours and venue schedule for that date.
                  </p>
                  <div className="mt-5 pt-4 border-t border-border/60 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <CalendarDays className="size-3.5 text-primary shrink-0" />
                    <span>Live Venue Calendar</span>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="bg-card border border-border/80 rounded-2xl p-6 md:p-8 flex flex-col relative shadow-xs hover:-translate-y-1.5 hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                  <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 text-primary font-black text-xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all duration-200 shadow-2xs">
                    02
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-foreground group-hover:text-primary transition-colors">
                    Choose Court &amp; Slot
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                    Browse our real-time availability grid across Courts 1 to 4. Click any open green slot to see the price and match details.
                  </p>
                  <div className="mt-5 pt-4 border-t border-border/60 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Crosshair className="size-3.5 text-primary shrink-0" />
                    <span>Courts 1–4 Matrix</span>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="bg-card border border-border/80 rounded-2xl p-6 md:p-8 flex flex-col relative shadow-xs hover:-translate-y-1.5 hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                  <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 text-primary font-black text-xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all duration-200 shadow-2xs">
                    03
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-foreground group-hover:text-primary transition-colors">
                    Confirm &amp; Play
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                    Check out securely in seconds. Your court reservation pass is issued immediately and accessible anytime under My Bookings.
                  </p>
                  <div className="mt-5 pt-4 border-t border-border/60 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    <span>Instant Match Pass</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Court Showcase & Venue Amenities */}
        <section id="courts" className="scroll-mt-20 w-full py-16 md:py-24 border-t">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
              {/* Left Column: Visual Showcase with Tactical Reticles */}
              <div className="lg:col-span-6 relative">
                <div className="aspect-16/10 rounded-2xl overflow-hidden border border-border bg-muted relative shadow-lg group">
                  <Image
                    src="/images/court-venue.jpg"
                    alt="Crosshair Dinkers tournament pickleball court facility"
                    fill
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent pointer-events-none" />

                  {/* Corner Reticle Accents */}
                  <div className="absolute top-3 left-3 size-4 border-t-2 border-l-2 border-primary/60 pointer-events-none" />
                  <div className="absolute top-3 right-3 size-4 border-t-2 border-r-2 border-primary/60 pointer-events-none" />
                  <div className="absolute bottom-16 left-3 size-4 border-b-2 border-l-2 border-primary/60 pointer-events-none" />
                  <div className="absolute bottom-16 right-3 size-4 border-b-2 border-r-2 border-primary/60 pointer-events-none" />

                  {/* Surface tag overlay - Direct, authoritative spec without kicker */}
                  <div className="absolute bottom-4 left-4 right-4 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl p-4 flex items-center justify-between shadow-sm">
                    <div>
                      <h3 className="text-sm sm:text-base font-extrabold text-foreground">
                        USAPA Regulation Court Standards
                      </h3>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        44′ × 20′ Tournament Sizing · 36″ Sidelines · 34″ Net
                      </p>
                    </div>
                    <Award className="size-5 text-primary shrink-0" />
                  </div>
                </div>
              </div>

              {/* Right Column: Court Details */}
              <div className="lg:col-span-6 space-y-6">
                <div>
                  <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-foreground">
                    Engineered for the Perfect Dink
                  </h2>
                  <p className="mt-3 text-base text-muted-foreground leading-relaxed">
                    Whether you are sharpening your third-shot drop or competing in weekend matches, our Butuan City facility delivers a premier playing environment designed for safety, precision, and peak athletic performance.
                  </p>
                </div>

                {/* Asymmetric Technical Feature Hierarchy */}
                <div className="space-y-4 pt-1">
                  {/* Hero Feature Card */}
                  <div className="p-5 rounded-xl border border-primary/30 bg-primary/5 hover:border-primary/50 transition-all duration-200">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2.5 text-primary font-bold text-base">
                        <Layers className="size-5" />
                        Tournament-Grade Acrylic Cushion Surface
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-primary px-2.5 py-0.5 rounded-md bg-primary/10 border border-primary/20 shrink-0">
                        5-Layer Cushion
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      Engineered multi-layer acrylic coating delivers true, consistent ball bounce while significantly absorbing joint impact during high-speed lateral rallies and third-shot drops.
                    </p>
                  </div>

                  {/* Supporting 2-Column Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="p-4 rounded-xl border border-border/80 bg-card hover:border-primary/40 transition-all duration-200">
                      <div className="flex items-center gap-2 text-foreground font-bold text-sm mb-1.5">
                        <SunMedium className="size-4 text-primary" />
                        Anti-Glare Night LED
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-2.5">
                        High-lux overhead stadium fixtures eliminate shadows for optimal ball tracking during night play.
                      </p>
                      <span className="text-[11px] font-semibold text-primary">500 Lux Stadium Spec</span>
                    </div>

                    <div className="p-4 rounded-xl border border-border/80 bg-card hover:border-primary/40 transition-all duration-200">
                      <div className="flex items-center gap-2 text-foreground font-bold text-sm mb-1.5">
                        <CheckCircle2 className="size-4 text-primary" />
                        Equipment &amp; Amenities
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-2.5">
                        Tournament paddles, Franklin balls, hydration station, shaded seating, and clean locker rooms.
                      </p>
                      <span className="text-[11px] font-semibold text-primary">Full Venue Gear Included</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Real-Time Booking Engine Section */}
        <section
          id="booking"
          className="scroll-mt-20 w-full flex flex-col items-center justify-center border-t bg-muted/15 py-16 md:py-24 relative overflow-hidden"
        >
          {/* Subtle Ambient Glow behind Booking Engine */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-primary/5 rounded-full blur-[100px] pointer-events-none -z-0" />

          <div className="container mx-auto px-4 max-w-6xl w-full relative z-10">
            <div className="mb-12 text-center max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary mb-4 shadow-2xs">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Booking Engine · Instant Conflict Locking
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight mb-3 text-foreground">
                Reserve Your Court
              </h2>
              <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
                Select your date, click an available slot on the live operational grid, and secure your court in seconds.
              </p>
            </div>

            <BookingContainer />
          </div>
        </section>

        {/* Player FAQ Section */}
        <FAQSection />

        {/* Location & Directions Landmark Banner */}
        <section id="location" className="scroll-mt-20 w-full py-16 md:py-24 border-t">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="rounded-2xl border border-border/80 bg-card p-6 md:p-10 shadow-sm relative overflow-hidden flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
              {/* Crosshair watermark in background */}
              <Crosshair className="absolute -right-8 -bottom-8 size-48 text-primary/5 pointer-events-none" />

              <div className="max-w-xl space-y-4 relative z-10">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/60 border border-border/60 px-3 py-1 rounded-full">
                  <MapPin className="size-3.5 text-primary" />
                  <span>Butuan City, Agusan Del Norte</span>
                </div>

                <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                  Visit Crosshair Dinkers
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  Located conveniently along J.C. Aquino Avenue in the heart of Butuan City. Come by for open play, tournament matches, or reserve a dedicated court with friends.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs sm:text-sm">
                  <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border/60 bg-muted/20">
                    <MapPin className="size-4 text-primary shrink-0" />
                    <span className="font-medium text-foreground">J.C. Aquino Ave, Butuan City</span>
                  </div>
                  <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border/60 bg-muted/20">
                    <Clock className="size-4 text-primary shrink-0" />
                    <span className="font-medium text-foreground">Open 7:00 AM – 10:00 PM Daily</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3.5 w-full lg:w-auto relative z-10 shrink-0">
                <a
                  href="#booking"
                  className="w-full sm:w-auto text-center px-7 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Reserve a Slot Now
                </a>
                <a
                  href="https://www.google.com/maps/search/?api=1&query=Crosshair+Dinkers+Butuan+City"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto text-center px-6 py-3.5 rounded-xl border border-border font-semibold text-sm hover:bg-muted hover:border-primary/30 transition-all text-foreground"
                >
                  Get Directions
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Comprehensive Venue Footer */}
      <footer id="contact" className="border-t bg-card py-12 md:py-16 text-sm text-muted-foreground">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            {/* Brand Col */}
            <div className="space-y-3 md:col-span-1">
              <div className="flex items-center gap-2 font-black text-base text-foreground tracking-tight">
                <div className="size-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Crosshair className="size-4" />
                </div>
                <span>Crosshair Dinkers</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Butuan City&apos;s premier pickleball destination. Built for players who value precision, community, and tournament-quality courts.
              </p>
            </div>

            {/* Quick Links */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-xs uppercase tracking-wider text-foreground">Navigation</h4>
              <ul className="space-y-1.5 text-xs">
                <li><a href="#home" className="hover:text-foreground transition-colors">Home</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a></li>
                <li><a href="#courts" className="hover:text-foreground transition-colors">Courts &amp; Amenities</a></li>
                <li><a href="#booking" className="hover:text-foreground transition-colors">Book a Court</a></li>
                <li><a href="#faq" className="hover:text-foreground transition-colors">Player FAQ</a></li>
              </ul>
            </div>

            {/* Operating Hours */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-xs uppercase tracking-wider text-foreground">Operating Schedule</h4>
              <p className="text-xs text-foreground font-semibold">Standard Venue Hours</p>
              <p className="text-xs text-muted-foreground">7:00 AM – 10:00 PM Daily</p>
              <a
                href="#booking"
                className="inline-block text-[11px] font-semibold text-primary hover:underline underline-offset-4 mt-0.5"
              >
                View Live Date Schedule &rarr;
              </a>
              <p className="text-[10px] text-muted-foreground/80">
                Philippine Standard Time (Asia/Manila).
              </p>
            </div>

            {/* Contact & Support */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-xs uppercase tracking-wider text-foreground">Contact Desk</h4>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <Phone className="size-3.5 text-primary" />
                  <span>+63 917 123 4567</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="size-3.5 text-primary" />
                  <span>play@crosshairdinkers.com</span>
                </div>
                <div className="flex items-start gap-2 pt-1 text-muted-foreground">
                  <MapPin className="size-3.5 text-primary shrink-0 mt-0.5" />
                  <span>J.C. Aquino Ave, Butuan City</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground/80">
            <p>&copy; {new Date().getFullYear()} Crosshair Dinkers. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <Link href="/my-bookings" className="hover:text-foreground transition-colors">
                My Bookings
              </Link>
              <span>•</span>
              <a href="#faq" className="hover:text-foreground transition-colors">
                Cancellation Policy
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
