"use client";

import Link from "next/link";
import { CalendarDays, Crosshair, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logout } from "@/lib/services/auth.service";
import { User } from "@supabase/supabase-js";
import { MapPin } from "lucide-react";
import { BookingContainer } from "@/components/customers/booking-container";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Public Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6 py-4 flex items-center justify-between">

        {/* Left: Logo */}
        <div className="flex-1 flex justify-start">
          <a href="#home" className="flex items-center gap-2 w-fit">
            <Crosshair className="size-5 md:size-6 text-primary" />
            <span className="font-bold text-lg md:text-xl tracking-tight hidden lg:inline-block">Crosshair Dinkers</span>
            <span className="font-bold text-lg tracking-tight lg:hidden">CD</span>
          </a>
        </div>

        {/* Center: Nav Links */}
        <nav className="hidden md:flex flex-1 justify-center items-center gap-6 lg:gap-8">
          <a href="#home" className="text-sm font-medium hover:text-foreground transition-colors">
            Home
          </a>
          <a href="#about" className="text-sm font-medium hover:text-foreground transition-colors">
            About
          </a>
          {user && (
            <Link href="/my-bookings" className="text-sm font-medium hover:text-foreground transition-colors">
              My Bookings
            </Link>
          )}
        </nav>

        {/* Right: Actions */}
        <div className="flex-1 flex justify-end items-center gap-2 md:gap-4">
          {user ? (
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          ) : (
            <Link href="/login" className="text-sm font-medium">
              <Button className="text-black" variant="link">Login</Button>
            </Link>
          )}
          <a href="#booking" className="bg-primary text-primary-foreground px-3 py-1.5 md:px-4 md:py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap">
            Book a Court
          </a>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {/* Hero Section */}
        <section id="home" className="scroll-mt-20 flex flex-col items-center justify-center text-center px-4 py-16 md:py-24 relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] md:w-[800px] md:h-[800px] bg-primary/5 rounded-full blur-[80px] md:blur-[120px] -z-10 pointer-events-none"></div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tighter max-w-4xl mb-4 md:mb-6 leading-tight md:leading-[1.1] text-foreground">
            Dink with precision. <br className="hidden md:block" />
            <span className="text-primary">Play your game.</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground/90 max-w-2xl mb-10 leading-relaxed font-medium">
            Welcome to Crosshair Dinkers, the premier pickleball venue. View live court availability and reserve your spot in seconds.
          </p>

          <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-4">
            <a
              href="#booking"
              className="group flex items-center justify-center gap-3 bg-primary text-primary-foreground px-8 py-3 md:py-4 rounded-full text-base md:text-lg font-bold hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 w-full sm:w-auto"
            >
              <CalendarDays className="size-5 group-hover:rotate-12 transition-transform" />
              View Availability
            </a>
          </div>

          {/* Venue Info Cards */}
          <div id="features" className="scroll-mt-24 mt-16 md:mt-24 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8 max-w-5xl w-full text-left">
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
        </section>

        {/* Booking Section */}
        <section id="booking" className="scroll-mt-20 w-full flex flex-col items-center justify-center border-t bg-muted/10 py-16 md:py-24">
          <div className="container mx-auto px-4 max-w-6xl w-full">
            <div className="mb-10 text-center">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Book a Court</h2>
              <p className="text-muted-foreground text-lg">Select a date and time to reserve your spot.</p>
            </div>
            <BookingContainer />
          </div>
        </section>

        {/* About Us Section */}
        <section id="about" className="scroll-mt-20 w-full flex flex-col items-center justify-center py-16 md:py-24 border-t">
          <div className="container mx-auto px-4 max-w-6xl flex flex-col md:flex-row items-center gap-12 md:gap-16">
            <div className="flex-1 space-y-6 text-center md:text-left">
              <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
                Our Story
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                About Crosshair Dinkers
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                We are passionate pickleball enthusiasts dedicated to growing the sport in Butuan City. Our state-of-the-art facility was built with one goal in mind: to provide the ultimate pickleball experience for players of all skill levels.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Whether you're a seasoned pro aiming to perfect your dink or a beginner just discovering the joy of the game, our premium courts and vibrant community will make you feel right at home.
              </p>
            </div>
            <div className="flex-1 w-full relative group mt-8 md:mt-0">
              <div className="aspect-[4/3] sm:aspect-video lg:aspect-[4/3] bg-card border rounded-2xl overflow-hidden relative shadow-lg transition-all duration-300 group-hover:shadow-xl group-hover:border-primary/20">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent flex items-center justify-center group-hover:from-primary/10 transition-colors duration-500">
                  <Crosshair className="size-24 md:size-32 text-primary/20 group-hover:text-primary/40 transition-all duration-500 group-hover:scale-110 group-hover:rotate-12" />
                </div>
              </div>

              {/* Floating Stat Card */}
              <div className="absolute -bottom-6 -left-2 sm:-bottom-6 sm:-left-6 bg-background border p-4 sm:p-5 rounded-xl shadow-xl z-10 transition-transform duration-300 group-hover:-translate-y-2">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Crosshair className="size-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-bold text-3xl text-foreground">100+</p>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Active Players</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer id="contact" className="border-t py-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-4">
        <p className="mt-4">&copy; {new Date().getFullYear()} Crosshair Dinkers. All rights reserved.</p>
      </footer>
    </div>
  );
}
