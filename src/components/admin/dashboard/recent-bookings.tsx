"use client"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchRecentBookings } from "@/lib/services/dashboard/recentBookings.service";
import { useState, useEffect } from "react";

type PaymentStatus = "Confirmed" | "Pending" | "Cancelled";

interface RecentBooking {
  customer: string;
  court: string;
  dateTime: string;
  amount: string;
  status: PaymentStatus;
}

const statusConfig: Record<
  PaymentStatus,
  { variant: "outline" | "secondary" | "destructive"; dotColor: string }
> = {
  Confirmed: { variant: "outline", dotColor: "bg-emerald-500" },
  Pending: { variant: "secondary", dotColor: "bg-amber-500" },
  Cancelled: { variant: "destructive", dotColor: "bg-rose-500" },
};

export default function RecentBookings() {

  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRecentBookings = async () => {
      setLoading(true);

      const { data } = await fetchRecentBookings();

      if (data) {
        setRecentBookings(data)
      }

      setLoading(false)
    };

    loadRecentBookings();
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Recent Bookings
        </CardTitle>

        <CardAction>
          <Link href="/admin/bookings">
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
        <div className="space-y-0">
          {loading ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b last:border-0">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="flex flex-col items-end gap-1 pl-4">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </>
          ) : recentBookings.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <span className="text-sm text-muted-foreground">
                No recent bookings yet.
              </span>
            </div>
          ) : (
            recentBookings.map((booking, index) => {
              const config = statusConfig[booking.status];

              return (
                <div
                  key={`${booking.dateTime}`}
                  className={`flex items-center justify-between py-3 ${index < recentBookings.length - 1 ? "border-b" : ""
                    }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {booking.customer}
                    </p>

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
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
