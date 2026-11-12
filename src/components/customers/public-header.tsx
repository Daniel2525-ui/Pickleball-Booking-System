"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, House, ListChecks, LoaderCircle, UserRound, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { AccountMenu } from "@/components/account-menu";
import { VENUE_NAME, brandInitials } from "@/lib/brand";

const initials = brandInitials(VENUE_NAME);
const navLink = "hidden md:inline-flex px-3 py-2 rounded-lg text-sm font-semibold text-foreground hover:bg-muted transition-colors";

export function PublicHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  // Only shows a link; /admin itself is still gated by the proxy
  const [isAdmin, setIsAdmin] = useState(false);
  // Front-desk staff see the staff panel link; admins (owners) the admin one
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState<boolean>(true);
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();

    const loadProfile = async (u: User | null) => {
      setUser(u);
      setLoading(false);
      if (!u) {
        setFullName("");
        setIsAdmin(false);
        setIsOwner(false);
        return;
      }
      const { data } = await supabase.from("profiles").select("full_name, role, is_owner").eq("id", u.id).maybeSingle();
      setFullName(data?.full_name ?? "");
      setIsAdmin(data?.role === "admin");
      setIsOwner(!!data?.is_owner);
    };

    supabase.auth.getUser().then(({ data: { user } }) => loadProfile(user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
    <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur-md px-4 sm:px-6 md:px-8 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-2.5 min-w-0">
        <span className="size-9 shrink-0 rounded-[10px] bg-primary text-primary-foreground grid place-items-center font-display font-bold text-sm">
          {initials}
        </span>
        <span className="font-display font-bold text-base sm:text-lg leading-tight text-foreground truncate">{VENUE_NAME}</span>
      </Link>

      <nav aria-label="Main" className="flex items-center gap-1 lg:gap-2 shrink-0">
        <Link href="/#booking" className={navLink}>Book a court</Link>
        <Link href="/#courts" className={navLink}>Courts</Link>
        <Link href="/open-play" className={navLink}>Open play</Link>
        <Link href="/#location" className={navLink}>Find us</Link>
        {user && isAdmin && (
          <Link href="/admin/dashboard" className="hidden md:inline-flex px-3 py-2 rounded-lg text-sm font-semibold text-primary hover:bg-muted transition-colors">
            {isOwner ? "Admin panel" : "Staff panel"}
          </Link>
        )}
        {user && (
          <Link href="/my-bookings" className="hidden sm:inline-flex px-3.5 min-h-10 items-center rounded-xl border border-input bg-card text-sm font-semibold text-foreground hover:bg-muted transition-colors">
            My bookings
          </Link>
        )}

        {loading ? (
          <div className="flex items-center justify-center size-10">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : user ? (
          <AccountMenu
            name={fullName}
            email={user.email ?? ""}
            signOutTo="/"
            links={[
              ...(isAdmin ? [{ label: isOwner ? "Admin panel" : "Staff panel", href: "/admin/dashboard", icon: "admin" as const }] : []),
              { label: "Courts", href: "/#courts", icon: "courts", mobileOnly: true },
              { label: "Open Play", href: "/open-play", icon: "openPlay", mobileOnly: true },
              { label: "My bookings", href: "/my-bookings", icon: "bookings", mobileOnly: true },
              { label: "My profile", href: "/profile", icon: "profile" },
            ]}
          />
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center px-4 min-h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>

    {/* Phones: the main places one thumb away. body:has(.mobile-tabbar) pads the page so nothing hides behind it */}
    <nav aria-label="Sections" className="mobile-tabbar md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t flex px-1 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {[
        { href: "/", label: "Home", icon: House, active: pathname === "/" },
        { href: "/#booking", label: "Book", icon: CalendarDays, active: false },
        { href: "/open-play", label: "Open play", icon: UsersRound, active: pathname.startsWith("/open-play") },
        { href: "/my-bookings", label: "Bookings", icon: ListChecks, active: pathname.startsWith("/my-bookings") },
        { href: user ? "/profile" : "/login", label: user ? "Account" : "Sign in", icon: UserRound, active: pathname.startsWith("/profile") },
      ].map(({ href, label, icon: Icon, active }) => (
        <Link
          key={label}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`flex-1 min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}
        >
          <Icon className="size-5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
    </>
  );
}
