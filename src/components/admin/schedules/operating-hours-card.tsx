import { Clock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OperatingHourRow } from "./operating-hour-row"
import { OperatingHour } from "./types"

interface OperatingHoursCardProps {
  hours: OperatingHour[]
  errorMsg: string | null
  onToggle: (index: number) => void
  onTimeChange: (index: number, field: "openTime" | "closeTime", value: string) => void
}

export function OperatingHoursCard({ hours, errorMsg, onToggle, onTimeChange }: OperatingHoursCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Operating Hours
        </CardTitle>
        <CardDescription>
          Set the hours when Crosshair Dinkers is open for bookings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {hours.map((hour, i) => (
            <OperatingHourRow
              key={hour.day}
              hour={hour}
              index={i}
              onToggle={onToggle}
              onTimeChange={onTimeChange}
            />
          ))}
        </div>
        
        {errorMsg && (
          <div className="mt-6 p-4 rounded-md bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20">
            {errorMsg}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
