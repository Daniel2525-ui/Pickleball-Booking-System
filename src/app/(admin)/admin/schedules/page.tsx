import { SchedulesContainer } from "@/components/admin/schedules/schedules-container"

export default function SchedulesPage() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-8 w-full max-w-6xl mx-auto">

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your venue's operating hours and booking availability.
          </p>
        </div>
      </div>
      <SchedulesContainer />
    </div>
  )
}
