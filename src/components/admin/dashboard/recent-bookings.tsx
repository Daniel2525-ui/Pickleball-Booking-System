"use client"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { fetchRecentBookings } from "@/lib/services/recentBookings.service";
import { useState, useEffect } from "react";

type PaymentStatus = "Confirmed" | "Pending";

interface RecentBooking {
  customer: string;
  court: string;
  dateTime: string;
  amount: string;
  status: PaymentStatus;
}

const statusConfig: Record<
  PaymentStatus,
  { variant: "outline" | "secondary"; dotColor: string }
> = {
  Confirmed: { variant: "outline", dotColor: "bg-emerald-500" },
  Pending: { variant: "secondary", dotColor: "bg-amber-500" },
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
            <div className="flex items-center justify-center gap-2 py-6">
              <LoaderCircle className="size-4 animate-spin" />
              <span className="text-sm text-muted-foreground">
                Fetching recent bookings...
              </span>
            </div>
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
                  key={`${booking.customer}-${booking.dateTime}`}
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
