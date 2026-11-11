"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Booking } from "@/lib/services/bookings/bookingsTypes";
import { BookingEvent, describeEvent } from "@/lib/services/bookings/bookingHistory";
import { fetchBookingHistory } from "@/lib/services/bookings/fetchBookingHistory.service";
import { bookingRef } from "@/lib/services/openPlay/bookingTitle";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Who did what to a booking, oldest first. */
export const BookingHistoryModal = ({ booking, onClose }: { booking: Booking | null; onClose: () => void }) => {
  const [events, setEvents] = useState<BookingEvent[] | null>(null);

  useEffect(() => {
    if (!booking) return;
    let ignore = false;
    fetchBookingHistory(booking.id).then(({ data }) => !ignore && setEvents(data));
    return () => {
      ignore = true;
      setEvents(null);
    };
  }, [booking]);

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Booking History</DialogTitle>
          <DialogDescription>
            {booking?.customer_name} · Ref {booking && bookingRef(booking)}
          </DialogDescription>
        </DialogHeader>
        {events === null ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No history recorded for this booking. History is kept for changes made after this feature went live.
          </p>
        ) : (
          <ol className="max-h-80 space-y-3 overflow-auto py-2">
            {events.map((e) => {
              const { what, who, detail } = describeEvent(e, booking?.user_id);
              return (
                <li key={e.id} className="border-l-2 border-border pl-3 text-sm">
                  <p>
                    <span className="font-semibold text-foreground">{what}</span>
                    <span className="text-muted-foreground"> by {who}</span>
                  </p>
                  {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                  <p className="text-[11px] text-muted-foreground">{when(e.created_at)}</p>
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
};
