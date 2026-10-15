import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { OperatingHour } from "./types"

interface OperatingHourRowProps {
  hour: OperatingHour
  index: number
  onToggle: (index: number) => void
  onTimeChange: (index: number, field: "open_time" | "close_time", value: string) => void
}

export const OperatingHourRow = ({ hour, index, onToggle, onTimeChange }: OperatingHourRowProps) => {
  const switchId = `toggle-${hour.day_of_week}`

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border transition-colors ${
        hour.is_open
          ? "bg-card hover:bg-accent/5 border-border"
          : "bg-muted/20 hover:bg-muted/30 border-dashed border-border/80 opacity-80"
      }`}
    >
      {/* Day & Toggle */}
      <div className="flex items-center justify-between sm:justify-start gap-4 sm:w-56">
        <div className="flex items-center gap-3">
          <Switch
            id={switchId}
            checked={hour.is_open}
            onCheckedChange={() => onToggle(index)}
            aria-label={`Toggle ${hour.day_of_week} operating status`}
          />
          <Label htmlFor={switchId} className="font-semibold text-base cursor-pointer select-none">
            {hour.day_of_week}
          </Label>
        </div>

        <span
          className={`sm:hidden inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
            hour.is_open
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
              : "bg-muted text-muted-foreground border border-border"
          }`}
        >
          {hour.is_open ? "Open" : "Closed"}
        </span>
      </div>

      {/* Time Range or Closed State */}
      {hour.is_open ? (
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 flex-1 justify-end">
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            Open
          </span>

          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <span className="sr-only">Opening Time</span>
              <Input
                type="time"
                value={hour.open_time}
                onChange={(e) => onTimeChange(index, "open_time", e.target.value)}
                aria-label={`${hour.day_of_week} opening time`}
                className="w-28 sm:w-32 h-9 text-sm"
              />
            </div>

            <span className="text-muted-foreground text-xs sm:text-sm font-medium px-0.5">to</span>

            <div className="flex flex-col">
              <span className="sr-only">Closing Time</span>
              <Input
                type="time"
                value={hour.close_time}
                onChange={(e) => onTimeChange(index, "close_time", e.target.value)}
                aria-label={`${hour.day_of_week} closing time`}
                className="w-28 sm:w-32 h-9 text-sm"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-1 justify-end">
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
            Closed
          </span>
          <span className="text-xs text-muted-foreground italic sm:w-[17.5rem] text-center">
            Courts unavailable for customer bookings
          </span>
        </div>
      )}
    </div>
  )
}

