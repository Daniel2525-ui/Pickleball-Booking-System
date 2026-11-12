import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { OperatingHour } from "./types"
import { hoursSummary } from "@/lib/services/schedule/hoursRules"

interface OperatingHourRowProps {
  hour: OperatingHour
  index: number
  onToggle: (index: number) => void
  onTimeChange: (index: number, field: "open_time" | "close_time", value: string) => void
}

// Opening hours as a bar over 6 AM to 6 AM the next day; null when the times aren't whole and set
const hoursBar = (open: string, close: string) => {
  const o = Number(open.slice(0, 2));
  const c = Number(close.slice(0, 2));
  if (!/^\d\d:/.test(open) || !/^\d\d:/.test(close)) return null;
  const from = (o - 6 + 24) % 24;
  const to = (close <= open ? c + 24 : c) - 6;
  return to > from ? { left: (from / 24) * 100, width: ((Math.min(to, 24) - from) / 24) * 100 } : null;
};

export const OperatingHourRow = ({ hour, index, onToggle, onTimeChange }: OperatingHourRowProps) => {
  const switchId = `toggle-${hour.day_of_week}`
  const bar = hour.is_open && hour.open_time && hour.close_time ? hoursBar(hour.open_time, hour.close_time) : null
  const summary = hour.is_open ? hoursSummary(hour.day_of_week, hour.open_time, hour.close_time) : null
  const summaryId = `hours-summary-${hour.day_of_week}`

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
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 flex-1 sm:justify-end w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border/50">
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            Open
          </span>

          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <div className="flex flex-col flex-1 min-w-0 sm:flex-initial">
                <span className="sr-only">Opening Time</span>
                <Input
                  type="time"
                  step={3600}
                  value={hour.open_time}
                  onChange={(e) => onTimeChange(index, "open_time", e.target.value)}
                  aria-label={`${hour.day_of_week} opening time`}
                  className="w-full sm:w-32 h-10 text-sm font-semibold"
                />
              </div>

              <span className="text-muted-foreground text-xs sm:text-sm font-medium px-1">to</span>

              <div className="flex flex-col flex-1 min-w-0 sm:flex-initial">
                <span className="sr-only">Closing Time</span>
                <Input
                  type="time"
                  step={3600}
                  value={hour.close_time}
                  onChange={(e) => onTimeChange(index, "close_time", e.target.value)}
                  aria-label={`${hour.day_of_week} closing time`}
                  aria-describedby={summary ? summaryId : undefined}
                  className="w-full sm:w-32 h-10 text-sm font-semibold"
                />
              </div>

              {/* "next day" belongs to the closing time; the slot keeps every row's fields lined up. Phones read it in the line below */}
              <span className={`hidden sm:inline shrink-0 w-16 text-xs font-semibold ${summary?.nextDay ? "text-primary" : "invisible"}`} aria-hidden={!summary?.nextDay}>
                next day
              </span>
            </div>

            {/* Reads the hours back in words, so 2 AM typed for 2 PM is easy to spot */}
            {summary && (
              <p id={summaryId} className="text-xs text-muted-foreground">{summary.text}</p>
            )}
          </div>

          {/* The day at a glance: 6 AM on the left, midnight at the line, 6 AM next day on the right */}
          {bar && (
            <div className="w-full sm:w-44 flex flex-col gap-1" aria-hidden>
              <div className="relative h-5 rounded-md bg-muted">
                <span className="absolute inset-y-0 left-3/4 w-px bg-foreground/30" />
                <span className="absolute top-1 bottom-1 rounded bg-primary" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
              </div>
              <div className="relative h-3 text-[10px] font-semibold text-muted-foreground">
                <span className="absolute left-3/4 -translate-x-1/2">midnight</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-start sm:justify-end gap-3 flex-1 pt-1 sm:pt-0 border-t sm:border-t-0 border-border/50">
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
            Closed
          </span>
          <span className="text-xs text-muted-foreground italic sm:w-[17.5rem] text-left sm:text-center">
            Courts unavailable for customer bookings
          </span>
        </div>
      )}
    </div>
  )
}

