"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoaderCircle } from "lucide-react";
import {
  fetchBookingOverview,
  type DayData,
} from "@/lib/services/dashboard/bookingOverview.service";
import { useEffect, useState } from "react";

export default function BookingOverview({ className }: { className?: string }) {
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOverview = async () => {
      setLoading(true);

      const { data } = await fetchBookingOverview();

      if (data) {
        setWeekData(data);
      }

      setLoading(false);
    };

    loadOverview();
  }, []);

  const maxBookings = Math.max(...weekData.map((d) => d.bookings), 1);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Booking Overview
        </CardTitle>
        <CardDescription>This week</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-[200px] items-center justify-center gap-2">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Loading overview...
            </span>
          </div>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
}
