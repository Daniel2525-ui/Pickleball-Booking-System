import { Metadata } from "next"
import { SchedulesContainer } from "@/components/admin/schedules/schedules-container"
import { VENUE_NAME } from "@/lib/brand";
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = {
  title: "Operating Hours | Admin",
  description: `Configure daily venue operating hours and booking availability for ${VENUE_NAME}.`,
}

export default function SchedulesPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <AdminPageHeader title="Hours & schedules" description="When players can book. Changing hours never moves bookings already made." />

      <SchedulesContainer />
    </div>
  )
}
