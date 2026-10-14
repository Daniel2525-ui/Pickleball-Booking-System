"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchBookingOverview } from "@/lib/services/dashboard/bookingOverview.service";
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

  const totalWeekBookings = weekData.reduce((acc, curr) => acc + curr.bookings, 0);
  const maxBookings = Math.max(...weekData.map((day) => day.bookings), 10);

  return (
    <Card className={`flex flex-col border border-border shadow-2xs ${className || ""}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-bold text-foreground">
            Weekly Booking Volume
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Total player reservations across the current week
          </CardDescription>
        </div>

        <div className="text-right">
          <span className="text-lg font-black text-foreground">
            {loading ? "..." : totalWeekBookings}
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total Matches
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col pb-6">
        {loading ? (
          <div className="flex flex-1 min-h-[220px] items-center justify-center pt-2">
            <Skeleton className="h-full w-full rounded-xl" />
          </div>
        ) : (
          <div className="flex gap-2 sm:gap-3 pt-4 flex-1 min-h-[220px] items-end">
            {weekData.map((day) => {
              const heightPercent = Math.max((day.bookings / maxBookings) * 100, 4);

              return (
                <div
                  key={day.day}
                  className="group flex flex-1 flex-col items-center gap-2 h-full justify-end"
                >
                  {/* Value count - visible for clarity */}
                  <span className="text-xs font-bold text-foreground">
                    {day.bookings}
                  </span>

                  {/* Volume Bar */}
                  <div className="relative w-full h-[150px] flex items-end justify-center bg-muted/40 rounded-lg p-1 overflow-hidden">
                    <div
                      className="w-full rounded-md bg-primary/75 group-hover:bg-primary transition-all duration-300"
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>

                  {/* Day label */}
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase">
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
