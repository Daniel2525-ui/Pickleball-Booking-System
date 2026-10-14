import { Clock, AlertCircle, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OperatingHourRow } from "./operating-hour-row"
import { OperatingHour } from "./types"

interface OperatingHoursCardProps {
  hours: OperatingHour[]
  errorMsg: string | null
  onToggle: (index: number) => void
  onTimeChange: (index: number, field: "open_time" | "close_time", value: string) => void
}

export const OperatingHoursCard = ({ hours, errorMsg, onToggle, onTimeChange }: OperatingHoursCardProps) => {
  const openDaysCount = hours.filter((h) => h.is_open).length

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl font-bold">
            <Clock className="h-5 w-5 text-primary" />
            Weekly Operating Schedule
          </CardTitle>
          <CardDescription className="mt-1">
            Configure court availability per day. Disabled days will be marked as Closed on the live customer calendar.
          </CardDescription>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0 self-start sm:self-auto">
          <span>{openDaysCount} of {hours.length} Days Open</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Desktop column guide */}
        <div className="hidden sm:flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2 bg-muted/40 rounded-lg">
          <span className="w-56">Day & Status Toggle</span>
          <div className="flex items-center gap-3 flex-1 justify-end">
            <span className="w-14 text-center">State</span>
            <span className="w-[17.5rem] text-center">Booking Window (Open — Close)</span>
            <span className="w-20 text-right">Duration</span>
          </div>
        </div>

        {/* Rows */}
        <div className="space-y-3">
          {hours.map((hour, i) => (
            <OperatingHourRow
              key={hour.day_of_week}
              hour={hour}
              index={i}
              onToggle={onToggle}
              onTimeChange={onTimeChange}
            />
          ))}
        </div>

        {/* Error message callout */}
        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20 animate-in fade-in-50 duration-200"
          >
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Schedule Configuration Conflict</p>
              <p className="text-xs text-destructive/90 mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Microcopy Helper */}
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
          <p>
            <strong className="font-semibold text-foreground">Time Format Guide:</strong> Times are configured in 24-hour format (HH:MM). Customers can only book 1-hour slots that start and end within these boundaries.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

