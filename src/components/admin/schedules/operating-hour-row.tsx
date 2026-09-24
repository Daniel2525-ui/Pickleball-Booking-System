import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { OperatingHour } from "./types"

interface OperatingHourRowProps {
  hour: OperatingHour
  index: number
  onToggle: (index: number) => void
  onTimeChange: (index: number, field: "openTime" | "closeTime", value: string) => void
}

export const OperatingHourRow = ({ hour, index, onToggle, onTimeChange }: OperatingHourRowProps) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border bg-card/50 hover:bg-accent/5 transition-colors">
      <div className="flex items-center gap-4 w-full sm:w-48">
        <Switch
          id={`${hour.day}`}
          checked={hour.isOpen}
          onCheckedChange={() => onToggle(index)}
        />
        <Label htmlFor={`toggle-${hour.day}`} className="font-medium text-base cursor-pointer">
          {hour.day}
        </Label>
      </div>

      {hour.isOpen ? (
        <div className="flex items-center gap-2 sm:gap-4 flex-1 justify-end">
          <span className="text-sm font-medium text-green-600 dark:text-green-500 w-16 text-center">Open</span>
          <Input
            type="time"
            value={hour.openTime}
            onChange={(e) => onTimeChange(index, "openTime", e.target.value)}
            className="w-32"
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="time"
            value={hour.closeTime}
            onChange={(e) => onTimeChange(index, "closeTime", e.target.value)}
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
