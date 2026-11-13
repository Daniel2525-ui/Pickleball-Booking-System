import { useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DateSelectorProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  /** First bookable day (midnight); after midnight this is still last night while its hours run */
  today: Date;
  isOpen: (date: Date) => boolean;
}

const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export const DateSelector = ({ selectedDate, onSelectDate, today, isOpen }: DateSelectorProps) => {
  const [view, setView] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const viewYear = view.getFullYear();
  const viewMonth = view.getMonth();

  const canGoPrev = view > new Date(today.getFullYear(), today.getMonth(), 1);
  const firstDay = view.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewYear, viewMonth, i + 1)),
  ];

  const monthLabel = view.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="bg-card border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CalendarIcon className="size-5 text-primary" />
          Select Date
        </h2>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-9 w-9"
            onClick={() => setView(new Date(viewYear, viewMonth - 1, 1))}
            disabled={!canGoPrev}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm sm:text-base font-bold text-foreground" aria-live="polite">{monthLabel}</span>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-9 w-9"
            onClick={() => setView(new Date(viewYear, viewMonth + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {daysOfWeek.map((day) => (
            <div key={day} className="text-center text-[11px] sm:text-xs font-semibold text-muted-foreground py-1.5">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="aspect-square" />;

            const isSelected = isSameDay(date, selectedDate);
            const isToday = isSameDay(date, today);
            const past = date < today;
            // Closed days stay selectable (muted) so players can see why, e.g. a holiday
            const closed = !past && !isOpen(date);

            return (
              <button
                key={date.toISOString()}
                disabled={past}
                onClick={() => onSelectDate(date)}
                aria-pressed={isSelected}
                aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + (closed ? ", closed" : "")}
                className={`
                  relative aspect-square w-full rounded-full flex items-center justify-center
                  text-xs sm:text-sm font-semibold transition-all touch-manipulation
                  ${isSelected
                    ? "bg-primary text-primary-foreground shadow-md"
                    : past
                      ? "text-muted-foreground/30 cursor-not-allowed"
                      : closed
                        ? "text-muted-foreground/50 line-through hover:bg-muted"
                      : isToday
                        ? "bg-primary/10 border-2 border-primary text-primary hover:bg-primary/20"
                        : "hover:bg-muted border border-transparent hover:border-border"
                  }
                `}
              >
                <span>{date.getDate()}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
