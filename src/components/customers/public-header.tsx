"use client";

import Link from "next/link";
import { Crosshair, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { AccountMenu } from "@/components/account-menu";

export function PublicHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  // Only shows a link; /admin itself is still gated by the proxy
  const [isAdmin, setIsAdmin] = useState(false);
  // Front-desk staff see the staff panel link; admins (owners) the admin one
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState<boolean>(true);

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
    <header className="sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur-md px-4 sm:px-6 md:px-8 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-2.5 group min-w-0">
        <div className="size-8 sm:size-9 shrink-0 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200">
          <Crosshair className="size-4 sm:size-4.5 transition-transform group-hover:rotate-45" />
        </div>
        {/* Icon only from sm to lg, where the nav links need the room; the link still has its name for screen readers */}
        <span className="font-display font-black text-lg sm:text-2xl tracking-wide leading-none text-foreground uppercase whitespace-nowrap sm:sr-only lg:not-sr-only">
          Crosshair <span className="text-primary">Dinkers</span>
        </span>
      </Link>

      <nav aria-label="Main" className="flex items-center gap-1 lg:gap-2 shrink-0">
        <Link href="/#booking" className="hidden sm:inline-flex px-3 py-2 rounded-lg text-sm font-bold text-foreground hover:bg-muted transition-colors">
          Book
        </Link>
        <Link href="/#courts" className="hidden sm:inline-flex px-3 py-2 rounded-lg text-sm font-bold text-foreground hover:bg-muted transition-colors">
          Courts
        </Link>
        <Link href="/open-play" className="hidden sm:inline-flex px-3 py-2 rounded-lg text-sm font-bold text-foreground hover:bg-muted transition-colors">
          Open Play
        </Link>
        {user && isAdmin && (
          <Link href="/admin/dashboard" className="hidden sm:inline-flex px-3 py-2 rounded-lg text-sm font-bold text-primary hover:bg-muted transition-colors">
            {isOwner ? "Admin panel" : "Staff panel"}
          </Link>
        )}
        {user && (
          <Link href="/my-bookings" className="hidden sm:inline-flex px-3 py-2 rounded-lg text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
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
              { label: "Courts", href: "/#courts", icon: "courts" },
              { label: "Open Play", href: "/open-play", icon: "openPlay" },
              { label: "My bookings", href: "/my-bookings", icon: "bookings" },
              { label: "My profile", href: "/profile", icon: "profile" },
            ]}
          />
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center px-4 min-h-[40px] rounded-lg bg-primary text-primary-foreground text-sm font-extrabold hover:bg-primary/90 transition-colors"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
