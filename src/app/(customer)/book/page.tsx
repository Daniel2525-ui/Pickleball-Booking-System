"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crosshair, LogOut, Home as HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingContainer } from "@/components/customers/booking-container";
import { createClient } from "@/lib/supabase/client";
import { logout } from "@/lib/services/auth.service";
import { User } from "@supabase/supabase-js";

export default function BookPage() {
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
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="px-6 md:px-6 py-4 flex items-center justify-between border-b bg-card">
        <Link href="/" className="flex items-center gap-2">
          <Crosshair className="size-5 md:size-6 text-primary" />
          <span className="font-bold text-lg md:text-xl tracking-tight hidden sm:inline-block">Crosshair Dinkers</span>
          <span className="font-bold text-lg tracking-tight sm:hidden">CD</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <HomeIcon className="size-4" />
              <span className="hidden sm:inline">Home</span>
            </Button>
          </Link>
          {user ? (
            <>
              <Link href="/my-bookings">
                <Button variant="ghost" size="sm" className="gap-2">
                  My Bookings
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2">
                <LogOut className="size-4" />
                Logout
              </Button>
            </>
          ) : (
            <Link href="/login">
              <Button variant="ghost" size="sm">Login</Button>
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Book a Court</h1>
          <p className="text-muted-foreground">Select a date and time to reserve your spot.</p>
        </div>

        <BookingContainer />
      </main>
    </div>
  );
}
