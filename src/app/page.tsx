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
            <div className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3 text-foreground">
                How Booking Works
              </h2>
              <p className="text-muted-foreground text-base md:text-lg">
                No phone calls, no waiting for replies. Check live availability and secure your court in three simple steps.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              {/* Step 1 */}
              <div className="bg-card border border-border/80 rounded-2xl p-6 md:p-8 flex flex-col relative shadow-xs hover:-translate-y-1.5 hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                <div className="size-11 rounded-xl bg-primary/10 border border-primary/20 text-primary font-black text-lg flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all duration-200">
                  1
                </div>
                <h3 className="text-xl font-bold mb-2 text-foreground group-hover:text-primary transition-colors">
                  Pick Your Date
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Select your desired playing day on our live operational calendar. View exact opening hours and venue schedule for that date.
                </p>
              </div>

              {/* Step 2 */}
              <div className="bg-card border border-border/80 rounded-2xl p-6 md:p-8 flex flex-col relative shadow-xs hover:-translate-y-1.5 hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                <div className="size-11 rounded-xl bg-primary/10 border border-primary/20 text-primary font-black text-lg flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all duration-200">
                  2
                </div>
                <h3 className="text-xl font-bold mb-2 text-foreground group-hover:text-primary transition-colors">
                  Choose Court &amp; Slot
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Browse our real-time availability grid across Courts 1 to 4. Click any open green slot to see the price and match details.
                </p>
              </div>

              {/* Step 3 */}
              <div className="bg-card border border-border/80 rounded-2xl p-6 md:p-8 flex flex-col relative shadow-xs hover:-translate-y-1.5 hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                <div className="size-11 rounded-xl bg-primary/10 border border-primary/20 text-primary font-black text-lg flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all duration-200">
                  3
                </div>
                <h3 className="text-xl font-bold mb-2 text-foreground group-hover:text-primary transition-colors">
                  Confirm &amp; Play
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Check out securely in seconds. Your court reservation pass is issued immediately and accessible anytime under My Bookings.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Court Showcase & Venue Amenities */}
        <section id="courts" className="scroll-mt-20 w-full py-16 md:py-24 border-t">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
              {/* Left Column: Visual Showcase */}
              <div className="lg:col-span-6 relative">
                <div className="aspect-16/10 rounded-2xl overflow-hidden border border-border bg-muted relative shadow-lg group">
                  <Image
                    src="/images/court-venue.jpg"
                    alt="Crosshair Dinkers tournament pickleball court facility"
                    fill
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent pointer-events-none" />

                  {/* Surface tag overlay */}
                  <div className="absolute bottom-4 left-4 right-4 bg-background/90 backdrop-blur-md border border-border/80 rounded-xl p-3.5 flex items-center justify-between shadow-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary">Venue Spec</p>
                      <p className="text-sm font-bold text-foreground">USAPA Regulation Sizing &amp; Net Standards</p>
                    </div>
                    <Award className="size-5 text-primary shrink-0" />
                  </div>
                </div>
              </div>

              {/* Right Column: Court Details */}
              <div className="lg:col-span-6 space-y-6">
                <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground">
                  Engineered for the Perfect Dink
                </h2>
                <p className="text-base text-muted-foreground leading-relaxed">
                  Whether you are sharpening your third-shot drop or competing in weekend matches, our Butuan City facility delivers a premier playing environment designed for safety, precision, and peak athletic performance.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="p-4 rounded-xl border bg-card/60 hover:border-primary/40 hover:bg-card/90 transition-all duration-200">
                    <div className="flex items-center gap-2 text-primary font-bold text-sm mb-1.5">
                      <Layers className="size-4" />
                      Acrylic Cushion Surface
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Multi-layered tournament coating ensures predictable ball response while reducing stress on knees and ankles.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border bg-card/60 hover:border-primary/40 hover:bg-card/90 transition-all duration-200">
                    <div className="flex items-center gap-2 text-primary font-bold text-sm mb-1.5">
                      <SunMedium className="size-4" />
                      Anti-Glare Night LED
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      High-lux overhead stadium lighting provides shadowless court coverage for evening and night tournaments.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border bg-card/60 hover:border-primary/40 hover:bg-card/90 transition-all duration-200">
                    <div className="flex items-center gap-2 text-primary font-bold text-sm mb-1.5">
                      <Award className="size-4" />
                      Paddle &amp; Ball Rental
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      High-performance paddles and Franklin tournament balls available at the front counter.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border bg-card/60 hover:border-primary/40 hover:bg-card/90 transition-all duration-200">
                    <div className="flex items-center gap-2 text-primary font-bold text-sm mb-1.5">
                      <CheckCircle2 className="size-4" />
                      Player Lounge &amp; Amenities
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Shaded spectator seating, hydration station, clean restrooms, and secure equipment lockers.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Real-Time Booking Engine Section */}
        <section
          id="booking"
          className="scroll-mt-20 w-full flex flex-col items-center justify-center border-t bg-muted/10 py-16 md:py-24"
        >
          <div className="container mx-auto px-4 max-w-6xl w-full">
            <div className="mb-10 text-center max-w-2xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3 text-foreground">
                Reserve Your Court
              </h2>
              <p className="text-muted-foreground text-base md:text-lg">
                Select your preferred date, click an available slot on the live grid, and confirm your reservation instantly.
              </p>
            </div>

            <BookingContainer />
          </div>
        </section>

        {/* Player FAQ Section */}
        <FAQSection />

        {/* Location & Directions Card */}
        <section id="location" className="scroll-mt-20 w-full py-16 border-t">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="rounded-2xl border bg-card p-6 md:p-10 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
              <div className="max-w-xl space-y-3">
                <h3 className="text-2xl font-bold tracking-tight text-foreground">
                  Visit Crosshair Dinkers
                </h3>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  Located conveniently in the heart of Butuan City. Come by for open play, tournament sessions, or reserve a dedicated court with friends.
                </p>

                <div className="pt-2 flex flex-col gap-2 text-sm text-foreground">
                  <div className="flex items-center gap-2.5">
                    <MapPin className="size-4.5 text-primary shrink-0" />
                    <span>Crosshair Dinkers Complex, J.C. Aquino Ave, Butuan City, Agusan Del Norte</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Clock className="size-4.5 text-primary shrink-0" />
                    <span>Open 7:00 AM – 10:00 PM Daily (Asia/Manila UTC+8)</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                <a
                  href="#booking"
                  className="w-full sm:w-auto text-center px-6 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Reserve a Slot Now
                </a>
                <a
                  href="https://maps.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto text-center px-5 py-3 rounded-xl border border-border font-semibold text-sm hover:bg-muted hover:border-primary/30 transition-all text-foreground"
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
              <p className="text-xs text-foreground font-semibold">Monday – Sunday</p>
              <p className="text-xs text-muted-foreground">7:00 AM – 10:00 PM</p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                Asia/Manila (UTC+8) venue operational time.
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
              <span>•</span>
              <Link href="/login" className="hover:text-foreground transition-colors">
                Staff Portal
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
