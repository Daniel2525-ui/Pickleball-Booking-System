"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, House, LogOut, UserRound } from "lucide-react";
import { logout } from "@/lib/services/auth.service";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AccountMenuProps {
  /** Profile full name; falls back to the email's local part */
  name: string;
  email: string;
  /** Icons are named so a Server Component (the admin layout) can pass links */
  links: { label: string; href: string; icon: keyof typeof ICONS }[];
  /** Where to land after signing out */
  signOutTo: string;
}

const ICONS = { bookings: CalendarDays, profile: UserRound, home: House };

/** Signed-in account menu (initials button + dropdown), shared by the customer and admin headers. */
export function AccountMenu({ name, email, links, signOutTo }: AccountMenuProps) {
  const router = useRouter();
  const shown = name || email.split("@")[0] || "";
  const initials = shown.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

  const handleLogout = async () => {
    await logout();
    router.push(signOutTo);
    router.refresh();
  };

  return (
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
        <span className="hidden sm:inline max-w-[8rem] truncate">{shown.split(/\s+/)[0]}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">Account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col py-2">
            <span className="font-bold text-foreground truncate">{shown}</span>
            <span className="text-xs font-normal text-muted-foreground truncate">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {links.map(({ label, href, icon }) => {
            const Icon = ICONS[icon];
            return (
            <DropdownMenuItem key={href} onClick={() => router.push(href)} className="gap-2 min-h-[40px]">
              <Icon className="size-4" />
              {label}
            </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleLogout} className="gap-2 min-h-[40px]">
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
