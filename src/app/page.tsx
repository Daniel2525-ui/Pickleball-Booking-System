import Link from "next/link";
import { CalendarDays, MapPin, Crosshair } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Public Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <Crosshair />
          <span className="font-bold text-xl tracking-tight">CrossHair Dinkers</span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/login" className="text-sm font-medium hover:underline underline-offset-4">Log in</Link>
          <Link href="/book" className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
            Book a Court
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight max-w-4xl mb-6">
          Dink with precision. <br className="hidden md:block" />
          <span className="text-primary">Play your game.</span>
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10">
          Welcome to CrossHair Dinkers, the premier pickleball venue. View live court availability and reserve your spot in seconds.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/book"
            className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-lg font-semibold hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl"
          >
            <CalendarDays className="size-5" />
            View Availability
          </Link>
        </div>

        {/* Venue Info Cards */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl w-full text-left">
          <div className="bg-card border p-6 rounded-2xl shadow-sm">
            <h3 className="font-bold text-lg mb-2">Premium Courts</h3>
            <p className="text-muted-foreground text-sm">Professional grade surfaces designed for the perfect bounce and player safety.</p>
          </div>
          <div className="bg-card border p-6 rounded-2xl shadow-sm">
            <h3 className="font-bold text-lg mb-2">Easy Booking</h3>
            <p className="text-muted-foreground text-sm">Real-time availability and instant reservations. Manage your bookings online.</p>
          </div>
          <div className="bg-card border p-6 rounded-2xl shadow-sm flex flex-col">
            <h3 className="font-bold text-lg mb-2">Location</h3>
            <p className="text-muted-foreground text-sm flex items-center gap-2 mt-auto">
              <MapPin className="size-4" /> 123 Pickleball Ave, City
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} CrossHair Dinkers. All rights reserved.</p>
      </footer>
    </div>
  );
}
