"use client";

import Link from "next/link";
import { Crosshair, LogOut, LoaderCircle, Menu, X, CalendarDays, HelpCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logout } from "@/lib/services/auth.service";
import { User } from "@supabase/supabase-js";

export function PublicHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    setLoading(true);
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
    setMobileMenuOpen(false);
  };

  const navLinks = [
    { label: "Home", href: "/#home" },
    { label: "How It Works", href: "/#how-it-works" },
    { label: "Courts & Amenities", href: "/#courts" },
    { label: "Book a Court", href: "/#booking" },
    { label: "Player FAQ", href: "/#faq" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur-md px-4 sm:px-6 md:px-8 py-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] flex items-center justify-between transition-colors">
      {/* Left: Logo */}
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="size-8 sm:size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200">
            <Crosshair className="size-4 sm:size-4.5 transition-transform group-hover:rotate-45" />
          </div>

          <div className="flex flex-col">
            <span className="font-extrabold text-base sm:text-lg tracking-tight leading-none text-foreground">
              Crosshair Dinkers
            </span>
            <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-widest mt-0.5">
              Butuan City
            </span>
          </div>
        </Link>
      </div>

      {/* Center: Desktop Nav Links */}
      <nav className="hidden lg:flex items-center gap-7">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {link.label}
          </Link>
        ))}

        {user && (
          <Link
            href="/my-bookings"
            className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5"
          >
            <CalendarDays className="size-3.5" />
            My Bookings
          </Link>
        )}
      </nav>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {loading ? (
          <div className="flex items-center justify-center w-8 h-8">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : user ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground h-9 px-3"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        ) : (
          <Link href="/login">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs font-semibold text-foreground hover:text-primary transition-colors h-9 px-3"
            >
              Sign In
            </Button>
          </Link>
        )}

        <Link
          href="/#booking"
          className="hidden sm:inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/90 transition-all shadow-sm hover:shadow"
        >
          <CalendarDays className="size-3.5" />
          Reserve Court
        </Link>

        {/* Mobile Menu Hamburger with 44x44px touch area */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden size-10 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile Backdrop & Drawer */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 top-[calc(57px+env(safe-area-inset-top))] bg-black/40 backdrop-blur-xs z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="lg:hidden absolute top-full left-0 right-0 bg-background/98 border-b border-border shadow-2xl backdrop-blur-xl px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col gap-3.5 animate-in slide-in-from-top-2 duration-200 z-50">
            <div className="flex flex-col gap-1 border-b border-border/80 pb-3">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="min-h-[44px] flex items-center px-3 rounded-lg text-sm font-semibold text-foreground hover:bg-muted/80 transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              {user ? (
                <>
                  <Link
                    href="/my-bookings"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full h-11 flex items-center justify-center rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors"
                  >
                    View My Bookings
                  </Link>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="w-full h-11 text-sm font-semibold justify-center gap-2 rounded-xl"
                  >
                    <LogOut className="size-4" />
                    Logout
                  </Button>
                </>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full h-11 flex items-center justify-center rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors"
                >
                  Sign In
                </Link>
              )}

              <Link
                href="/#booking"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full h-11 flex items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-md hover:bg-primary/90 transition-all"
              >
                Book a Court
              </Link>
            </div>
          </div>
        </>
      )}
    </header>
  );
}