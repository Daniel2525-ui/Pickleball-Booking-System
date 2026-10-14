"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CalendarX } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { todaysSchedule } from "@/lib/services/dashboard/schedToday.service";
import { useState, useEffect } from "react";
import { formatTime12h } from "@/lib/utils/formatTime";
import { calculateDuration } from "@/lib/helpers/totalDuration";

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  ongoing: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 font-semibold",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20 line-through opacity-75",
  completed: "bg-muted text-muted-foreground border-border",
};

const getStatusColor = (status: string) =>
  statusStyles[status.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";

interface ScheduleItem {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  court_id: string;
  courts?: { name: string } | null;
  profiles?: { full_name: string } | null;
}

export default function TodaysSchedule({
  className,
}: {
  className?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);

  useEffect(() => {
    const getSchedule = async () => {
      try {
        const data = await todaysSchedule();
        setSchedule(data as unknown as ScheduleItem[]);
      } finally {
        setLoading(false);
      }
    };

    getSchedule();
  }, []);

  return (
    <Card className={`border border-border shadow-2xs ${className || ""}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-bold text-foreground">
            Today&apos;s Court Schedule
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time player match lineup for today
          </p>
        </div>

        <CardAction>
          <Link href="/admin/schedules">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Full Schedule
              <ArrowRight className="size-3" />
            </Button>
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div className="overflow-y-auto max-h-[300px] pr-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border/80 text-left text-xs text-muted-foreground">
                <th className="pb-2.5 pr-4 font-semibold uppercase tracking-wider text-[11px] bg-card">Time Slot</th>
                <th className="pb-2.5 pr-4 font-semibold uppercase tracking-wider text-[11px] bg-card">Court</th>
                <th className="pb-2.5 pr-4 font-semibold uppercase tracking-wider text-[11px] bg-card">Booked By</th>
                <th className="pb-2.5 pr-4 font-semibold uppercase tracking-wider text-[11px] bg-card">Duration</th>
                <th className="pb-2.5 font-semibold uppercase tracking-wider text-[11px] bg-card">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/50">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="py-3.5 pr-4">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="py-3.5 pr-4">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="py-3.5 pr-4">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="py-3.5 pr-4">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="py-3.5">
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </td>
                  </tr>
                ))
              ) : schedule.length > 0 ? (
                schedule.map((booking) => (
                  <tr
                    key={booking.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-3 pr-4 font-semibold text-foreground text-xs sm:text-sm whitespace-nowrap">
                      {`${formatTime12h(booking.start_time)} – ${formatTime12h(booking.end_time)}`}
                    </td>

                    <td className="py-3 pr-4 font-medium text-xs sm:text-sm whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold text-xs">
                        {booking.courts?.name || `Court ${booking.court_id}`}
                      </span>
                    </td>

                    <td className="py-3 pr-4 font-medium text-foreground text-xs sm:text-sm">
                      {booking.profiles?.full_name || "Guest Player"}
                    </td>

                    <td className="py-3 pr-4 text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                      {calculateDuration(booking.start_time, booking.end_time)}
                    </td>

                    <td className="py-3 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={`text-xs capitalize font-semibold ${getStatusColor(booking.status)}`}
                      >
                        {booking.status}
                      </Badge>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <CalendarX className="size-8 text-muted-foreground/40" />
                      <p className="text-sm font-semibold text-foreground">No matches scheduled today</p>
                      <p className="text-xs text-muted-foreground">All courts are currently open for walk-ins and reservations.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
