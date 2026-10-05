"use client";

import Link from "next/link";
import { Crosshair, LogOut, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logout } from "@/lib/services/auth.service";
import { User } from "@supabase/supabase-js";

export function PublicHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true)
    const supabase = createClient();

    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setUser(user);
      setLoading(false);
    };

    checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6 py-4 flex items-center justify-between">
      {/* Left: Logo */}
      <div className="flex-1 flex justify-start">
        <a href="#home" className="flex items-center gap-2 w-fit">
          <Crosshair className="size-5 md:size-6 text-primary" />

          <span className="font-bold text-lg md:text-xl tracking-tight hidden lg:inline-block">
            Crosshair Dinkers
          </span>

          <span className="font-bold text-lg tracking-tight lg:hidden">
            CD
          </span>
        </a>
      </div>

      {/* Center: Nav Links */}
      <nav className="hidden md:flex flex-1 justify-center items-center gap-6 lg:gap-8">
        <a
          href="#home"
          className="text-sm font-medium hover:text-foreground transition-colors"
        >
          Home
        </a>

        <a
          href="#about"
          className="text-sm font-medium hover:text-foreground transition-colors"
        >
          About
        </a>

        {loading ? (
          <LoaderCircle className="h-6 w-6 animate-spin" />
        ) : (
          user && (
            <Link
              href="/my-bookings"
              className="text-sm font-medium hover:text-foreground transition-colors"
            >
              My Bookings
            </Link>
          )
        )}
      </nav>

      {/* Right: Actions */}
      <div className="flex-1 flex justify-end items-center gap-2 md:gap-4">
        {loading ? (
          <div className="flex items-center justify-center w-[72px]">
            <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : user ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-2"
          >
            <LogOut className="size-4" />

            <span className="hidden sm:inline">
              Logout
            </span>
          </Button>
        ) : (
          <Link href="/login" className="text-sm font-medium">
            <Button className="text-black" variant="link">
              Login
            </Button>
          </Link>
        )}

        <a
          href="#booking"
          className="bg-primary text-primary-foreground px-3 py-1.5 md:px-4 md:py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
        >
          Book a Court
        </a>
      </div>
    </header>
  );
}