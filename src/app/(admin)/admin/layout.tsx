import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import AppSidebar from "@/components/admin/app-sidebar"
import { Crosshair } from "lucide-react"
import { createClient } from "@/lib/supabase/server"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The proxy already gates /admin to admins; this only reads who is signed in for the account menu
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name, is_owner").eq("id", user.id).maybeSingle()
    : { data: null }

  return (
    <SidebarProvider>
      <AppSidebar account={user ? { name: profile?.full_name ?? "", email: user.email ?? "" } : null} isOwner={!!profile?.is_owner} />
      <main className="w-full min-h-screen flex flex-col bg-background text-foreground">
        {/* Responsive Admin App Header */}
        <header className="sticky top-0 z-30 h-14 flex items-center bg-background/90 backdrop-blur-md px-4 sm:px-6 pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="size-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted" />
            <div className="flex items-center gap-2 md:hidden">
              <div className="flex aspect-square size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Crosshair className="size-3.5" />
              </div>
              <span className="font-extrabold text-sm tracking-tight text-foreground">
                Crosshair Dinkers <span className="text-[10px] font-semibold text-muted-foreground uppercase ml-1">{profile?.is_owner ? "Admin" : "Staff"}</span>
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 pb-safe">
          {children}
        </div>
      </main>
    </SidebarProvider>
  )
}
