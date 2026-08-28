import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import AppSidebar from "@/components/app-sidebar"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="w-full min-h-screen flex flex-col">
        <div className="p-2">
            <SidebarTrigger />
        </div>
        <div className="flex-1">
            {children}
        </div>
      </main>
    </SidebarProvider>
  )
}
