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
    CreditCard,
    Crosshair,
    Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";

interface NavItem {
    title: string;
    url: string;
    icon: React.ComponentType<{ className?: string }>;
}

const operationsNav: NavItem[] = [
    {
        title: "Dashboard",
        url: "/admin/dashboard",
        icon: LayoutDashboard,
    },
    {
        title: "Bookings",
        url: "/admin/bookings",
        icon: CalendarDays,
    },
    {
        title: "Courts",
        url: "/admin/courts",
        icon: Layers,
    },
    {
        title: "Operating Hours",
        url: "/admin/schedules",
        icon: Clock,
    },
    {
        title: "Pricing",
        url: "/admin/pricing",
        icon: Tag,
    },
];

const managementNav: NavItem[] = [
    {
        title: "Customer Directory",
        url: "/admin/customers",
        icon: Users,
    },
    {
        title: "Payments & Revenue",
        url: "/admin/payments",
        icon: CreditCard,
    },
    {
        title: "Settings",
        url: "/admin/settings",
        icon: Settings,
    },
];

export default function AppSidebar({ account }: { account: { name: string; email: string } | null }) {
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
                                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200">
                                    <Crosshair className="size-4.5 transition-transform group-hover:rotate-45" />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-extrabold text-foreground">
                                        Crosshair Dinkers
                                    </span>
                                    <span className="truncate text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                                        Court Admin
                                    </span>
                                </div>
                            </SidebarMenuButton>
                        </Link>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent className="pt-2">
                {/* Operations Section */}
                <SidebarGroup>
                    <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-3">
                        Operations
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-1">
                            {operationsNav.map((item) => {
                                const isActive = currentPath === item.url || currentPath.startsWith(`${item.url}/`);
                                const Icon = item.icon;

                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <Link href={item.url}>
                                            <SidebarMenuButton
                                                className="cursor-pointer py-5 [&>svg]:size-4 font-medium transition-colors"
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

                {/* Management & Finance Section */}
                <SidebarGroup className="pt-2">
                    <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-3">
                        Management
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-1">
                            {managementNav.map((item) => {
                                const isActive = currentPath === item.url || currentPath.startsWith(`${item.url}/`);
                                const Icon = item.icon;

                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <Link href={item.url}>
                                            <SidebarMenuButton
                                                className="cursor-pointer py-5 [&>svg]:size-4 font-medium transition-colors"
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
                            { label: "Profile and password", href: "/profile", icon: "profile" },
                        ]}
                    />
                </SidebarFooter>
            )}
        </Sidebar>
    );
}
