"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Inbox } from "lucide-react";
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
  { label: string; dotColor: string }
> = {
  Confirmed: { label: "Confirmed", dotColor: "bg-emerald-500" },
  Pending: { label: "Pending", dotColor: "bg-amber-500" },
  Cancelled: { label: "Cancelled", dotColor: "bg-rose-500" },
};

export default function RecentBookings() {
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRecentBookings = async () => {
      setLoading(true);
      const { data } = await fetchRecentBookings();

      if (data) {
        setRecentBookings(data);
      }

      setLoading(false);
    };

    loadRecentBookings();
  }, []);

  return (
    <Card className="border border-border shadow-2xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-bold text-foreground">
            Recent Reservations
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Most recently booked court slots
          </p>
        </div>

        <CardAction>
          <Link href="/admin/bookings">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              All Bookings
              <ArrowRight className="size-3" />
            </Button>
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div className="space-y-0">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-28 mb-1.5" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <div className="flex flex-col items-end gap-1.5 pl-4">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))
          ) : recentBookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
              <Inbox className="size-8 text-muted-foreground/40" />
              <p className="text-sm font-semibold text-foreground">No recent reservations</p>
              <p className="text-xs text-muted-foreground">New customer bookings will appear here automatically.</p>
            </div>
          ) : (
            recentBookings.map((booking, index) => {
              const config = statusConfig[booking.status] || statusConfig.Pending;

              return (
                <div
                  key={index}
                  className={`flex items-center justify-between py-3.5 hover:bg-muted/20 px-1 rounded-lg transition-colors ${index < recentBookings.length - 1 ? "border-b border-border/50" : ""
                    }`}
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="text-sm font-bold text-foreground truncate">
                      {booking.customer}
                    </p>

                    <p className="mt-0.5 text-xs text-muted-foreground truncate">
                      <span className="font-semibold text-primary">{booking.court}</span> · {booking.dateTime}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-sm font-black text-foreground">
                      {booking.amount}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block size-1.5 rounded-full ${config.dotColor}`} />
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {config.label}
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
