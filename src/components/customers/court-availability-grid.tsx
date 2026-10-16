import { Clock, Check } from "lucide-react";
import { Slot } from "./types";
import { SlotStatus } from "@/lib/services/bookings/checkSlotAvailability.service";

interface CourtAvailabilityGridProps {
  selectedDate: Date;
  courts: string[];
  timeSlots: string[];
  onSlotClick: (court: string, time: string) => void;
  getSlotStatus: (date: Date, court: string, time: string) => SlotStatus;
  selectedSlot?: Slot | null;
}

export const CourtAvailabilityGrid = ({
  selectedDate,
  courts,
  timeSlots,
  onSlotClick,
  getSlotStatus,
  selectedSlot,
}: CourtAvailabilityGridProps) => {
  const colCount = courts.length;

  return (
    <div className="bg-card border rounded-2xl shadow-sm overflow-hidden flex-1">
      <div className="p-4 border-b bg-muted/30 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="size-5 text-primary" />
          Available Times
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" /> Pending / Resume
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/40" /> Booked
          </span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="min-w-[600px] md:min-w-[800px]">
          {/* Grid Header */}
          <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] border-b">
            <div className="p-4 border-r font-medium text-sm flex items-center justify-center text-muted-foreground sticky left-0 z-20 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
              Time
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
            >
              {courts.map((court, i) => (
                <div key={i} className="p-4 text-center font-medium border-l first:border-l-0 text-sm">
                  {court}
                </div>
              ))}
            </div>
          </div>

          {/* Grid Body */}
          <div className="divide-y">
            {timeSlots.map((time, timeIdx) => (
              <div key={timeIdx} className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] hover:bg-muted/30 transition-colors group">
                <div className="p-2 border-r flex items-center justify-center text-xs md:text-sm text-center font-medium sticky left-0 z-10 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] group-hover:bg-muted/30 transition-colors">
                  {time}
                </div>
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
                >
                  {courts.map((court, courtIdx) => {
                    const status = getSlotStatus(selectedDate, court, time);
                    const isSelected = selectedSlot?.court === court && selectedSlot?.time === time;

                    return (
                      <div key={courtIdx} className="p-2 border-l first:border-l-0 h-full">
                        {isSelected ? (
                          <button
                            onClick={() => onSlotClick(court, time)}
                            className="w-full h-full min-h-[48px] bg-primary text-primary-foreground rounded-lg transition-all duration-200 text-xs md:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-md hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <Check className="size-4" />
                            Selected
                          </button>
                        ) : status === "available" ? (
                          <button
                            onClick={() => onSlotClick(court, time)}
                            className="w-full h-full min-h-[48px] bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground rounded-lg transition-all duration-200 text-xs md:text-sm font-semibold flex items-center justify-center border border-primary/30 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            Available
                          </button>
                        ) : status === "user_pending" ? (
                          <button
                            onClick={() => onSlotClick(court, time)}
                            className="w-full h-full min-h-[48px] bg-amber-500/15 hover:bg-amber-500 text-amber-800 dark:text-amber-300 hover:text-white rounded-lg transition-all duration-200 text-xs md:text-sm font-bold flex items-center justify-center gap-1.5 border border-amber-500/40 hover:border-amber-500 shadow-xs hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                            title="Your pending reservation. Click to resume payment or cancel."
                          >
                            <Clock className="size-3.5" />
                            Resume
                          </button>
                        ) : status === "pending" ? (
                          <div className="w-full h-full min-h-[48px] bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg flex items-center justify-center text-xs md:text-sm cursor-not-allowed uppercase font-semibold tracking-wider">
                            Pending
                          </div>
                        ) : (
                          <div className="w-full h-full min-h-[48px] bg-muted/50 rounded-lg flex items-center justify-center text-muted-foreground/60 text-xs md:text-sm cursor-not-allowed uppercase font-semibold tracking-wider">
                            {status === "maintenance" ? "Maintenance" : status === "closed" ? "Closed" : status === "passed" ? "Passed" : "Booked"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
