"use client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { todaysSchedule } from "@/lib/services/dashboard/schedToday.service";
import { useState, useEffect } from "react";
import { formatTime12h } from "@/lib/utils/formatTime";
import { calculateDuration } from "@/lib/helpers/totalDuration";

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  confirmed: "secondary",
  pending: "outline",
  ongoing: "default",
  cancelled: "destructive",
  completed: "outline",
  Ongoing: "default",
  Upcoming: "secondary",
  Completed: "outline",
  Cancelled: "destructive",
};

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
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
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <LoaderCircle className="size-5 animate-spin" />
                      <span>Fetching today&apos;s schedule...</span>
                    </div>
                  </td>
                </tr>
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
                        variant={
                          statusVariant[booking.status] || "default"
                        }
                        className="capitalize"
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
