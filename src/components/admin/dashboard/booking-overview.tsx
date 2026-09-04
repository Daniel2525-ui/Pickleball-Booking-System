import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DayData {
  day: string;
  shortDay: string;
  bookings: number;
}

const weekData: DayData[] = [
  { day: "Monday", shortDay: "Mon", bookings: 8 },
  { day: "Tuesday", shortDay: "Tue", bookings: 12 },
  { day: "Wednesday", shortDay: "Wed", bookings: 10 },
  { day: "Thursday", shortDay: "Thu", bookings: 15 },
  { day: "Friday", shortDay: "Fri", bookings: 18 },
  { day: "Saturday", shortDay: "Sat", bookings: 22 },
  { day: "Sunday", shortDay: "Sun", bookings: 14 },
];

const maxBookings = Math.max(...weekData.map((d) => d.bookings));

export default function BookingOverview({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Booking Overview
        </CardTitle>
        <CardDescription>This week</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3 pt-2" style={{ height: "200px" }}>
          {weekData.map((day) => {
            const heightPercent = (day.bookings / maxBookings) * 100;

            return (
              <div
                key={day.day}
                className="group flex flex-1 flex-col items-center gap-2"
              >
                {/* Value label */}
                <span className="text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {day.bookings}
                </span>

                {/* Bar */}
                <div className="relative w-full flex-1">
                  <div
                    className="absolute bottom-0 w-full rounded-md bg-primary/80 transition-colors group-hover:bg-primary"
                    style={{ height: `${heightPercent}%`, minHeight: "4px" }}
                  />
                </div>

                {/* Day label */}
                <span className="text-xs text-muted-foreground">
                  {day.shortDay}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
