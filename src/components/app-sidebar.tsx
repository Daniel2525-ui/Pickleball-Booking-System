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
import { Calendar, LayoutDashboard, Settings, User, SquareMinus, CreditCard, Clock, Crosshair, LogOut } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import handleLogout from "@/app/services/auth.service"


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
    {
        title: "Settings",
        url: "/admin/settings",
        icon: Settings,
    },
]

export default function AppSidebar() {

    const currentPath = usePathname();
    const router = useRouter();

    async function onLogout() {
        await handleLogout()
        router.push("/login")
        router.refresh()
    }

    return (
        <Sidebar>
            <SidebarHeader className="pt-6 pb-4 px-4">
                <div className="flex items-center gap-1">
                    <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-black text-white dark:bg-white dark:text-black shadow-sm">
                        <Crosshair className="size-6" />
                    </div>
                    <div className="flex flex-col gap-1 leading-none">
                        <span className="font-semibold text-lg tracking-tight">CrossHair Dinkers</span>
                        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Booking System</span>
                    </div>
                </div>
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
            <SidebarFooter className="pb-5">
                <Button
                    className="gap-2 w-full"
                    variant="destructive"
                    onClick={onLogout}
                >
                    <LogOut className="size-4" /> Logout
                </Button>
            </SidebarFooter>
        </Sidebar>
    )
}
