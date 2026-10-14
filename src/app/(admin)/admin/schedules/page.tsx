import { Metadata } from "next"
import { Clock } from "lucide-react"
import { SchedulesContainer } from "@/components/admin/schedules/schedules-container"

export const metadata: Metadata = {
  title: "Operating Hours | Admin",
  description: "Configure daily venue operating hours and booking availability for Crosshair Dinkers.",
}

export default function SchedulesPage() {
  return (
    <div className="flex flex-col gap-6 p-4 lg:p-8 w-full max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operating Hours & Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure daily opening and closing hours for Crosshair Dinkers. These hours dictate available reservation slots on the customer booking portal.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground border border-border shrink-0 self-start sm:self-auto">
          <Clock className="h-3.5 w-3.5 text-primary" />
          <span>Venue Timezone: Asia/Manila (PST / UTC+8)</span>
        </div>
      </div>

      <SchedulesContainer />
    </div>
  )
}
