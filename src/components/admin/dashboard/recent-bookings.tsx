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

type PaymentStatus = "Confirmed" | "Pending";

interface RecentBooking {
  customer: string;
  court: string;
  dateTime: string;
  amount: string;
  status: PaymentStatus;
}

const recentBookingsData: RecentBooking[] = [
  {
    customer: "Juan Dela Cruz",
    court: "Court 2",
    dateTime: "Today, 5:00 PM",
    amount: "₱500",
    status: "Confirmed",
  },
  {
    customer: "Maria Santos",
    court: "Court 4",
    dateTime: "Today, 6:00 PM",
    amount: "₱750",
    status: "Confirmed",
  },
  {
    customer: "Pedro Garcia",
    court: "Court 1",
    dateTime: "Tomorrow, 3:00 PM",
    amount: "₱500",
    status: "Pending",
  },
  {
    customer: "Ana Reyes",
    court: "Court 3",
    dateTime: "Tomorrow, 4:00 PM",
    amount: "₱500",
    status: "Confirmed",
  },
  {
    customer: "Carlos Mendoza",
    court: "Court 5",
    dateTime: "Tomorrow, 5:00 PM",
    amount: "₱750",
    status: "Pending",
  },
];

const statusConfig: Record<
  PaymentStatus,
  { variant: "outline" | "secondary"; dotColor: string }
> = {
  Confirmed: { variant: "outline", dotColor: "bg-emerald-500" },
  Pending: { variant: "secondary", dotColor: "bg-amber-500" },
};

export default function RecentBookings({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Recent Bookings
        </CardTitle>
        <CardAction>
          <Link href="/admin/bookings">
            <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
              View All
              <ArrowRight className="size-3" />
            </Button>
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {recentBookingsData.map((booking, index) => {
            const config = statusConfig[booking.status];

            return (
              <div
                key={`${booking.customer}-${booking.dateTime}`}
                className={`flex items-center justify-between py-3 ${index < recentBookingsData.length - 1 ? "border-b" : ""
                  }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{booking.customer}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {booking.court} · {booking.dateTime}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 pl-4">
                  <span className="text-sm font-semibold">
                    {booking.amount}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block size-1.5 rounded-full ${config.dotColor}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {booking.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
