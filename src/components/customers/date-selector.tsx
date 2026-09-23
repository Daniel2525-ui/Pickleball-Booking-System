import { useState, useCallback } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperatingHour } from "@/components/admin/schedules/types";
import { formatTime12h } from "@/lib/utils/formatTime";

interface DateSelectorProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  operatingHours: OperatingHour[];
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBeforeToday(date: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);
  return compare < today;
}

export function DateSelector({ selectedDate, onSelectDate, operatingHours }: DateSelectorProps) {
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }, [viewMonth, viewYear]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }, [viewMonth, viewYear]);

  const isDayOpen = (date: Date): boolean => {
    const dayName = FULL_DAYS[date.getDay()];
    const schedule = operatingHours.find((hour) => hour.day === dayName);
    return !!schedule?.isOpen;
  };

  const getScheduleForDate = (date: Date): OperatingHour | undefined => {
    const dayName = FULL_DAYS[date.getDay()];
    return operatingHours.find((h) => h.day === dayName);
  };

  const selectedSchedule = getScheduleForDate(selectedDate);

  // Prevent navigating to months before the current month
  const canGoPrev = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth > today.getMonth());

  // Build calendar grid cells
  const cells = [];
  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    cells.push(null);
  }
  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(viewYear, viewMonth, d));
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="mb-8 bg-card border rounded-2xl shadow-sm overflow-hidden">
      {/* Calendar Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CalendarIcon className="size-5 text-primary" />
          Select Date
        </h2>
      </div>

      <div className="p-4 md:p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Calendar Grid */}
          <div className="flex-1">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="outline"
                size="icon"
                className="rounded-full h-8 w-8"
                onClick={prevMonth}
                disabled={!canGoPrev}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-sm font-semibold">{monthLabel}</span>
              <Button variant="outline" size="icon" className="rounded-full h-8 w-8" onClick={nextMonth}>
                <ChevronRight className="size-4" />
              </Button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {DAYS_OF_WEEK.map((day) => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Date cells */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((date, i) => {
                if (!date) {
                  return <div key={`empty-${i}`} className="aspect-square" />;
                }

                const past = isBeforeToday(date);
                const isSelected = isSameDay(date, selectedDate);
                const isToday = isSameDay(date, today);
                const open = isDayOpen(date);
                const disabled = past;

                return (
                  <button
                    key={date.toISOString()}
                    disabled={disabled}
                    onClick={() => onSelectDate(date)}
                    className={`
                      relative aspect-square rounded-xl flex flex-col items-center justify-center
                      text-sm font-medium transition-all
                      ${disabled
                        ? "text-muted-foreground/30 cursor-not-allowed"
                        : isSelected
                          ? "bg-primary text-primary-foreground shadow-md scale-105"
                          : isToday
                            ? "bg-primary/10 border-2 border-primary text-primary hover:bg-primary/20"
                            : "hover:bg-muted border border-transparent hover:border-border"
                      }
                    `}
                  >
                    <span>{date.getDate()}</span>
                    {!disabled && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full mt-0.5 ${open
                          ? isSelected
                            ? "bg-primary-foreground/80"
                            : "bg-green-500"
                          : isSelected
                            ? "bg-primary-foreground/40"
                            : "bg-muted-foreground/30"
                          }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Open
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                Closed
              </div>
            </div>
          </div>

          {/* Selected Date Info Panel */}
          <div className="lg:w-64 lg:border-l lg:pl-6">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Selected Date
              </p>
              <p className="text-lg font-bold">
                {selectedDate.toLocaleDateString("en-CA", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>

              {selectedSchedule ? (
                selectedSchedule.isOpen ? (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <Clock className="size-4 text-green-500" />
                    <span className="text-green-600 dark:text-green-400 font-medium">
                      {formatTime12h(selectedSchedule.openTime)} – {formatTime12h(selectedSchedule.closeTime)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <X className="size-4 text-muted-foreground" />
                    <span className="text-muted-foreground font-medium">Closed</span>
                  </div>
                )
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  No schedule data
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
