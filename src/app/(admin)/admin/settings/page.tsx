import { Metadata } from "next"
import { SettingsContainer } from "@/components/admin/settings/settings-container"

export const metadata: Metadata = {
  title: "Settings | Admin",
  description: "Manage contact details, booking rules and staff access.",
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <header className="sticky top-14 z-20 bg-background/95 backdrop-blur-md pt-6 pb-4 sm:pt-7 border-b border-border/60 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Payment details, venue contact, booking rules and staff access.
        </p>
      </header>

      <SettingsContainer />
    </div>
  )
}
