"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { CalendarDays, CalendarPlus, ChevronDown, House, Layers, LayoutDashboard, LogOut, MapPin, UserRound, UsersRound } from "lucide-react";
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
  /** mobileOnly: hidden from xl up, where the header already shows the same link */
  links: { label: string; href: string; icon: keyof typeof ICONS; mobileOnly?: boolean }[];
  /** Where to land after signing out */
  signOutTo: string;
  /** A guest (no account): signing out asks first, since this device then can't show their bookings again */
  guest?: boolean;
  /** Full-width trigger with email that opens upward, for a sidebar footer; collapses to the avatar */
  inSidebar?: boolean;
}

// Same icons as the staff sidebar uses for these pages
const ICONS = { bookings: CalendarDays, book: CalendarPlus, location: MapPin, courts: Layers, openPlay: UsersRound, profile: UserRound, home: House, admin: LayoutDashboard };

/** Signed-in account menu (initials button + dropdown), shared by the customer and admin headers. */
export function AccountMenu({ name, email, links, signOutTo, inSidebar = false, guest = false }: AccountMenuProps) {
  const router = useRouter();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const shown = name || email.split("@")[0] || "";
  const initials = shown.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

  const handleLogout = async () => {
    await logout();
    router.push(signOutTo);
    router.refresh();
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={
              inSidebar
                ? "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left text-sm hover:bg-sidebar-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:p-0"
                : "flex items-center gap-2 rounded-full border bg-card pl-1 pr-2.5 py-1 min-h-[40px] font-bold text-sm hover:border-muted-foreground/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            }
          />
        }
      >
        <span className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-extrabold" aria-hidden>
          {initials}
        </span>
        {inSidebar ? (
          <span className="grid flex-1 min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-bold">{shown}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </span>
        ) : (
          <span className="hidden sm:inline max-w-[8rem] truncate">{shown.split(/\s+/)[0]}</span>
        )}
        <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground ${inSidebar ? "rotate-180 group-data-[collapsible=icon]:hidden" : ""}`} aria-hidden />
        <span className="sr-only">Account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={inSidebar ? "top" : "bottom"} align={inSidebar ? "start" : "end"} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col py-2">
            <span className="font-bold text-foreground truncate">{shown}</span>
            <span className="text-xs font-normal text-muted-foreground truncate">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {links.map(({ label, href, icon, mobileOnly }) => {
            const Icon = ICONS[icon];
            return (
            <DropdownMenuItem key={href} onClick={() => router.push(href)} className={`gap-2 min-h-[40px]${mobileOnly ? " xl:hidden" : ""}`}>
              <Icon className="size-4" />
              {label}
            </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            guest
              ? setConfirmRequest({
                  title: "Sign out of your guest bookings?",
                  description:
                    "You booked without an account, so once you sign out this device can't show those bookings again. Your confirmation email still has the details. Create an account first to keep them.",
                  confirmLabel: "Sign out anyway",
                  cancelLabel: "Stay signed in",
                  onConfirm: handleLogout,
                })
              : handleLogout()
          }
          className="gap-2 min-h-[40px]"
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </>
  );
}
