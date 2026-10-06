"use client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { todaysSchedule } from "@/lib/services/dashboard/schedToday.service";
import { useState, useEffect } from "react";
import { formatTime12h } from "@/lib/utils/formatTime";
import { calculateDuration } from "@/lib/helpers/totalDuration";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/50",
  pending: "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-amber-200 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/50",
  ongoing: "bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 border-blue-200 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/50",
  cancelled: "bg-red-500/15 text-red-700 hover:bg-red-500/25 border-red-200 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/50",
  completed: "bg-slate-500/15 text-slate-700 hover:bg-slate-500/25 border-slate-200 dark:text-slate-400 dark:border-slate-800 dark:hover:bg-slate-900/50",
};

const getStatusColor = (status: string) => STATUS_STYLES[status.toLowerCase()] ?? "bg-slate-500/15 text-slate-700 hover:bg-slate-500/25 border-slate-200 dark:text-slate-400 dark:border-slate-800 dark:hover:bg-slate-900/50";

export default function TodaysSchedule({
  className,
}: {
  className?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<any[]>([]);

  useEffect(() => {
    const getSchedule = async () => {
      try {
        const data = await todaysSchedule();
        setSchedule(data);
      } finally {
        setLoading(false);
      }
    };

    getSchedule();
  }, []);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Today&apos;s Schedule
        </CardTitle>

        <CardAction>
          <Link href="/admin/schedules">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-muted-foreground"
            >
              View All
              <ArrowRight className="size-3" />
            </Button>
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div className="overflow-auto max-h-[400px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Time</th>
                <th className="pb-3 pr-4 font-medium">Court</th>
                <th className="pb-3 pr-4 font-medium">Customer</th>
                <th className="pb-3 pr-4 font-medium">Duration</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-4 pr-4">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="py-4 pr-4">
                        <Skeleton className="h-4 w-20" />
                      </td>
                      <td className="py-4 pr-4">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="py-4 pr-4">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="py-4">
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </td>
                    </tr>
                  ))}
                </>
              ) : schedule.length > 0 ? (
                schedule.map((booking) => (
                  <tr
                    key={booking.id}
                    className="border-b last:border-0"
                  >
                    <td className="py-3 pr-4 font-medium">
                      {`${formatTime12h(booking.start_time)} - ${formatTime12h(booking.end_time)}`}
                    </td>

                    <td className="py-3 pr-4 font-medium">
                      {booking.courts?.name ||
                        `Court ${booking.court_id}`}
                    </td>

                    <td className="py-3 pr-4 font-medium">
                      {booking.profiles
                        ? booking.profiles.full_name || "Unknown"
                        : "Unknown"}
                    </td>

                    <td className="py-3 pr-4 font-medium">
                      {calculateDuration(
                        booking.start_time,
                        booking.end_time
                      )}
                    </td>

                    <td className="py-3">
                      <Badge
                        variant="outline"
                        className={`capitalize ${getStatusColor(booking.status)}`}
                      >
                        {booking.status}
                      </Badge>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No schedule for today.
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
