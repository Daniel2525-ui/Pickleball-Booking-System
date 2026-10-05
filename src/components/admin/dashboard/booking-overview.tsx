"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchBookingOverview
} from "@/lib/services/dashboard/bookingOverview.service";
import { useEffect, useState } from "react";
import { DayData } from "@/lib/services/dashboard/dashboardTypes";
import { supabase } from "@/lib/supabase";

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

    // Subscribe to new bookings to update the graph in real-time
    const channel = supabase
      .channel("booking-overview-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          // Re-fetch when a booking is added, updated, or deleted
          fetchBookingOverview().then(({ data }) => {
            if (data) setWeekData(data);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Use a minimum max-scale (e.g., 5 or 10) so the bars can visually "grow" from smaller numbers.
  // Otherwise, the highest day will ALWAYS be 100% height, showing no visual progress.
  const maxBookings = Math.max(...weekData.map((day) => day.bookings), 10);

  return (
    <Card className={`flex flex-col ${className || ""}`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Booking Overview
        </CardTitle>
        <CardDescription>This week</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pb-6">
        {loading ? (
          <div className="flex flex-1 min-h-[200px] items-center justify-center pt-2">
            <Skeleton className="h-full w-full rounded-md" />
          </div>
        ) : (
          <div className="flex gap-3 pt-2 flex-1 min-h-[200px]">
            {weekData.map((day) => {
              const heightPercent = (day.bookings / maxBookings) * 100;

              return (
                <div
                  key={day.day}
                  className="group flex flex-1 flex-col items-center gap-2 h-full"
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
