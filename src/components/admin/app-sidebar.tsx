"use client";

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
    LayoutDashboard,
    CalendarDays,
    Layers,
    Users,
    Clock,
    Tag,
    Wallet,
    Settings,
    UsersRound,
    BarChart3,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { VENUE_NAME, brandInitials } from "@/lib/brand";

interface NavItem {
    title: string;
    url: string;
    icon: React.ComponentType<{ className?: string }>;
    /** Owner only: hidden from front-desk staff (proxy.ts also redirects them) */
    ownerOnly?: boolean;
}

// Grouped by what the desk does: today's work first, then the venue set-up, then people and money
const navGroups: { label: string; items: NavItem[] }[] = [
    {
        label: "Today",
        items: [
            { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
            { title: "Bookings", url: "/admin/bookings", icon: CalendarDays },
            { title: "Payments", url: "/admin/payments", icon: Wallet },
        ],
    },
    {
        label: "Venue",
        items: [
            { title: "Courts", url: "/admin/courts", icon: Layers },
            { title: "Hours & schedules", url: "/admin/schedules", icon: Clock },
            { title: "Open play", url: "/admin/open-play", icon: UsersRound },
            { title: "Prices", url: "/admin/pricing", ownerOnly: true, icon: Tag },
        ],
    },
    {
        label: "People & money",
        items: [
            { title: "Customers", url: "/admin/customers", icon: Users },
            { title: "Reports", url: "/admin/reports", ownerOnly: true, icon: BarChart3 },
        ],
    },
    {
        label: "Setup",
        items: [{ title: "Settings", url: "/admin/settings", ownerOnly: true, icon: Settings }],
    },
];

export default function AppSidebar({ account, isOwner }: { account: { name: string; email: string } | null; isOwner: boolean }) {
    const currentPath = usePathname();

    return (
        <Sidebar collapsible="icon">
            {/* Sidebar Header / Brand Emblem */}
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <Link href="/admin/dashboard">
                            <SidebarMenuButton
                                size="lg"
                                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group"
                            >
                                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-display font-bold text-xs">
                                    {brandInitials(VENUE_NAME)}
                                </span>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-display font-bold text-foreground">
                                        {VENUE_NAME}
                                    </span>
                                    <span className="truncate text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                                        {isOwner ? "Court Admin" : "Court Staff"}
                                    </span>
                                </div>
                            </SidebarMenuButton>
                        </Link>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent className="pt-1">
                {navGroups.map((group) => {
                    const items = group.items.filter((item) => isOwner || !item.ownerOnly);
                    if (items.length === 0) return null;
                    return (
                        <SidebarGroup key={group.label} className="py-1">
                            <SidebarGroupLabel className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-3">
                                {group.label}
                            </SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu className="gap-0.5">
                                    {items.map((item) => {
                                        const isActive = currentPath === item.url || currentPath.startsWith(`${item.url}/`);
                                        const Icon = item.icon;
                                        return (
                                            <SidebarMenuItem key={item.title}>
                                                <Link href={item.url}>
                                                    <SidebarMenuButton
                                                        className="cursor-pointer py-5 [&>svg]:size-4 font-medium transition-colors data-[active=true]:font-semibold"
                                                        isActive={isActive}
                                                        tooltip={item.title}
                                                    >
                                                        <Icon className={isActive ? "text-primary" : "text-muted-foreground"} />
                                                        <span>{item.title}</span>
                                                    </SidebarMenuButton>
                                                </Link>
                                            </SidebarMenuItem>
                                        );
                                    })}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    );
                })}
            </SidebarContent>

            {account && (
                <SidebarFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <AccountMenu
                        inSidebar
                        name={account.name}
                        email={account.email}
                        signOutTo="/login"
                        links={[
                            { label: "Customer site", href: "/", icon: "home" },
                            { label: "My profile", href: "/profile", icon: "profile" },
                        ]}
                    />
                </SidebarFooter>
            )}
        </Sidebar>
    );
}
