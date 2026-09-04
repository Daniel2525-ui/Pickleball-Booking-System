import Link from "next/link";
import { CalendarDays, MapPin, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Public Header */}
      <header className="px-6 md:px-6 py-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <Crosshair className="size-5 md:size-6" />
          <span className="font-bold text-lg md:text-xl tracking-tight hidden sm:inline-block">Crosshair Dinkers</span>
          <span className="font-bold text-lg tracking-tight sm:hidden">CD</span>
        </div>
        <nav className="flex items-center md:gap-6">
          <Link href="/login" className="text-sm font-medium">
            <Button className={"text-black"} variant={"link"}>Login</Button>
          </Link>
          <Link href="/login" className="bg-primary text-primary-foreground px-3 py-1.5 md:px-4 md:py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
            Book a Court
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-16 md:py-24 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] md:w-[800px] md:h-[800px] bg-primary/5 rounded-full blur-[80px] md:blur-[120px] -z-10 pointer-events-none"></div>
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight max-w-4xl mb-4 md:mb-6 leading-tight">
          Dink with precision. <br className="hidden md:block" />
          <span className="text-primary">Play your game.</span>
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10">
          Welcome to Crosshair Dinkers, the premier pickleball venue. View live court availability and reserve your spot in seconds.
        </p>

        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-4">
          <Link
            href="/book"
            className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3 md:py-4 rounded-full text-base md:text-lg font-semibold hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl w-full sm:w-auto"
          >
            <CalendarDays className="size-5" />
            View Availability
          </Link>
        </div>

        {/* Venue Info Cards */}
        <div className="mt-16 md:mt-24 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8 max-w-5xl w-full text-left">
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
            <p className="text-muted-foreground text-sm">Butuan City, Agusan Del Norte</p>
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
