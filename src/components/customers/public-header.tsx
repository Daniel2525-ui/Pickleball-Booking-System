"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crosshair, LoaderCircle, ChevronDown, CalendarDays, UserRound, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logout } from "@/lib/services/auth.service";
import { User } from "@supabase/supabase-js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function PublicHeader() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const supabase = createClient();

    const loadProfile = async (u: User | null) => {
      setUser(u);
      setLoading(false);
      if (!u) return setFullName("");
      const { data } = await supabase.from("profiles").select("full_name").eq("id", u.id).maybeSingle();
      setFullName(data?.full_name ?? "");
    };

    supabase.auth.getUser().then(({ data: { user } }) => loadProfile(user));

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
    router.push("/");
    router.refresh();
  };

  const name = fullName || user?.email?.split("@")[0] || "";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur-md px-4 sm:px-6 md:px-8 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-2.5 group min-w-0">
        <div className="size-8 sm:size-9 shrink-0 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200">
          <Crosshair className="size-4 sm:size-4.5 transition-transform group-hover:rotate-45" />
        </div>
        <span className="font-display font-black text-lg sm:text-2xl tracking-wide leading-none text-foreground uppercase whitespace-nowrap">
          Crosshair <span className="text-primary">Dinkers</span>
        </span>
      </Link>

      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2 shrink-0">
        <Link href="/#booking" className="hidden sm:inline-flex px-3 py-2 rounded-lg text-sm font-bold text-foreground hover:bg-muted transition-colors">
          Book
        </Link>
        {user && (
          <Link href="/my-bookings" className="px-2 sm:px-3 py-2 rounded-lg text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            My bookings
          </Link>
        )}

        {loading ? (
          <div className="flex items-center justify-center size-10">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border bg-card pl-1 pr-2.5 py-1 min-h-[40px] font-bold text-sm hover:border-muted-foreground/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <span className="size-8 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-extrabold" aria-hidden>
                {initials}
              </span>
              <span className="hidden sm:inline max-w-[8rem] truncate">{name.split(/\s+/)[0]}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="sr-only">Account menu</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex flex-col py-2">
                  <span className="font-bold text-foreground truncate">{fullName || "Player"}</span>
                  <span className="text-xs font-normal text-muted-foreground truncate">{user.email}</span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => router.push("/my-bookings")} className="gap-2 min-h-[40px]">
                  <CalendarDays className="size-4" />
                  My bookings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/profile")} className="gap-2 min-h-[40px]">
                  <UserRound className="size-4" />
                  Profile and password
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleLogout} className="gap-2 min-h-[40px]">
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
