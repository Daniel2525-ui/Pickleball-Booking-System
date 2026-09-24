import { Clock } from "lucide-react";

interface CourtAvailabilityGridProps {
  selectedDate: Date;
  courts: string[];
  timeSlots: string[];
  onSlotClick: (court: string, time: string) => void;
  getSlotStatus: (date: Date, court: string, time: string) => "available" | "booked" | "maintenance" | "closed";
}

export function CourtAvailabilityGrid({
  selectedDate,
  courts,
  timeSlots,
  onSlotClick,
  getSlotStatus,
}: CourtAvailabilityGridProps) {
  const colCount = courts.length;

  return (
    <div className="bg-card border rounded-2xl shadow-sm overflow-hidden flex-1">
      <div className="p-4 border-b bg-muted/30">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="size-5 text-primary" />
          Available Times
        </h2>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Grid Header */}
          <div className="grid grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] border-b">
            <div className="p-4 border-r bg-muted/10 font-medium text-sm flex items-center justify-center text-muted-foreground">
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
              <div key={timeIdx} className="grid grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] hover:bg-muted/5 transition-colors">
                <div className="p-2 border-r bg-muted/10 flex items-center justify-center text-xs md:text-sm text-center font-medium">
                  {time}
                </div>
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
                >
                  {courts.map((court, courtIdx) => {
                    const status = getSlotStatus(selectedDate, court, time);
                    return (
                      <div key={courtIdx} className="p-2 border-l first:border-l-0 h-full">
                        {status === "available" ? (
                          <button
                            onClick={() => onSlotClick(court, time)}
                            className="w-full h-full min-h-[48px] bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground rounded-lg transition-all text-xs md:text-sm font-medium flex items-center justify-center border border-primary/20 hover:shadow-md"
                          >
                            Available
                          </button>
                        ) : (
                          <div className="w-full h-full min-h-[48px] bg-muted/50 rounded-lg flex items-center justify-center text-muted-foreground/60 text-xs md:text-sm cursor-not-allowed uppercase font-semibold tracking-wider">
                            {status === "maintenance" ? "Maintenance" : status === "closed" ? "Closed" : "Booked"}
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
