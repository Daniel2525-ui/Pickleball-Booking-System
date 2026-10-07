"use client"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Calendar, LayoutDashboard, User, SquareMinus, CreditCard, Clock, Crosshair, LogOut } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { logout } from "@/lib/services/auth.service"

const items = [
    {
        title: "Dashboard",
        url: "/admin/dashboard",
        icon: LayoutDashboard,
    },
    {
        title: "Bookings",
        url: "/admin/bookings",
        icon: Calendar,
    },
    {
        title: "Courts",
        url: "/admin/courts",
        icon: SquareMinus,
    },
    {
        title: "Customers",
        url: "/admin/customers",
        icon: User,
    },
    {
        title: "Schedules",
        url: "/admin/schedules",
        icon: Clock,
    },
    {
        title: "Payments",
        url: "/admin/payments",
        icon: CreditCard,
    },
]

export default function AppSidebar() {

    const currentPath = usePathname();
    const router = useRouter();

    async function handleLogout() {
        await logout()
        router.push("/login")
        router.refresh()
    }

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-black text-white dark:bg-white dark:text-black">
                                <Crosshair className="size-5" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">Crosshair Dinkers</span>
                                <span className="truncate text-xs">Booking System</span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent className="pt-4">
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-1">
                            {items.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <Link href={item.url}>
                                        <SidebarMenuButton className="cursor-pointer py-5 [&>svg]:size-4" isActive={currentPath === item.url}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </SidebarMenuButton>
                                    </Link>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton onClick={handleLogout} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <LogOut />
                            <span>Logout</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    )
}
