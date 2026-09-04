import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

type BookingStatus = "Ongoing" | "Upcoming" | "Completed" | "Cancelled";

interface ScheduleEntry {
  time: string;
  court: string;
  customer: string;
  duration: string;
  status: BookingStatus;
}

const scheduleData: ScheduleEntry[] = [
  {
    time: "2:00 PM",
    court: "Court 1",
    customer: "Juan Dela Cruz",
    duration: "1 hour",
    status: "Ongoing",
  },
  {
    time: "3:00 PM",
    court: "Court 3",
    customer: "Maria Santos",
    duration: "2 hours",
    status: "Upcoming",
  },
  {
    time: "4:00 PM",
    court: "Court 2",
    customer: "Pedro Garcia",
    duration: "1 hour",
    status: "Upcoming",
  },
  {
    time: "5:00 PM",
    court: "Court 5",
    customer: "Mark Santos",
    duration: "1 hour",
    status: "Upcoming",
  },
];

const statusVariant: Record<
  BookingStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  Ongoing: "default",
  Upcoming: "secondary",
  Completed: "outline",
  Cancelled: "destructive",
};

export default function TodaysSchedule({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Today&apos;s Schedule
        </CardTitle>
        <CardAction>
          <Link href="/admin/schedules">
            <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
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
              {scheduleData.map((entry) => (
                <tr
                  key={`${entry.time}-${entry.court}`}
                  className="border-b last:border-0"
                >
                  <td className="py-3 pr-4 font-medium">{entry.time}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {entry.court}
                  </td>
                  <td className="py-3 pr-4">{entry.customer}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {entry.duration}
                  </td>
                  <td className="py-3">
                    <Badge variant={statusVariant[entry.status]}>
                      {entry.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
