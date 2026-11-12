import { Metadata } from "next"
import { SettingsContainer } from "@/components/admin/settings/settings-container"
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = {
  title: "Settings | Admin",
  description: "Manage contact details, booking rules and staff access.",
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <AdminPageHeader title="Settings" description="Venue contact details, booking policies and staff access." />

      <SettingsContainer />
    </div>
  )
}
