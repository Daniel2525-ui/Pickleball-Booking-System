import { Metadata } from "next"
import { ReportsContainer } from "@/components/admin/reports/reports-container"

export const metadata: Metadata = {
  title: "Reports | Admin",
  description: "Revenue, bookings, busy hours and best customers for Crosshair Dinkers.",
}

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <ReportsContainer />
    </div>
  )
}
