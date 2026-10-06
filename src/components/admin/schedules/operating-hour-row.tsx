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
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border bg-card/50 hover:bg-accent/5 transition-colors">
      <div className="flex items-center gap-4 w-full sm:w-48">
        <Switch
          id={`${hour.day_of_week}`}
          checked={hour.is_open}
          onCheckedChange={() => onToggle(index)}
        />
        <Label htmlFor={`toggle-${hour.day_of_week}`} className="font-medium text-base cursor-pointer">
          {hour.day_of_week}
        </Label>
      </div>

      {hour.is_open ? (
        <div className="flex items-center gap-2 sm:gap-4 flex-1 justify-end">
          <span className="text-sm font-medium text-green-600 dark:text-green-500 w-16 text-center">Open</span>
          <Input
            type="time"
            value={hour.open_time}
            onChange={(e) => onTimeChange(index, "open_time", e.target.value)}
            className="w-32"
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="time"
            value={hour.close_time}
            onChange={(e) => onTimeChange(index, "close_time", e.target.value)}
            className="w-32"
          />
        </div>
      ) : (
        <div className="flex items-center gap-4 flex-1 justify-end">
          <span className="text-sm font-medium text-muted-foreground bg-muted px-3 py-1 rounded-md">
            Closed
          </span>
          <div className="w-32 invisible hidden sm:block" />
          <span className="invisible hidden sm:block">—</span>
          <div className="w-32 invisible hidden sm:block" />
        </div>
      )}
    </div>
  )
}
