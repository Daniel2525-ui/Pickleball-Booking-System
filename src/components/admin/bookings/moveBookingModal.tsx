"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Booking } from "@/lib/services/bookings/bookingsTypes";
import { Court } from "@/lib/services/courts/courtsTypes";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { formatTime12h, formatShortDate } from "@/lib/utils/formatTime";

export interface MovedBooking {
  court_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
}

const hourOf = (t: string) => parseInt(t.slice(0, 2), 10);
const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Moves a confirmed court booking to another court, date or start time; the length and price stay the same. */
export const MoveBookingModal = ({
  booking,
  onClose,
  onMoved,
}: {
  booking: Booking | null;
  onClose: () => void;
  onMoved: (bookingId: string, moved: MovedBooking, courtName: string) => void;
}) => {
  const [courts, setCourts] = useState<Court[]>([]);
  const [courtId, setCourtId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prev, setPrev] = useState<Booking | null>(null);

  if (booking !== prev) {
    setPrev(booking);
    setCourtId(booking?.court_id ?? "");
    setDate(booking?.booking_date ?? "");
    setStart(booking?.start_time.slice(0, 5) ?? "");
    setError(null);
  }

  useEffect(() => {
    if (!booking) return;
    fetchCourtsData().then(({ data }) => setCourts(data.filter((c) => c.status !== "maintenance")));
  }, [booking]);

  // Hours booked; an end at 00:00 is midnight, the end of the day
  const length = booking ? (hourOf(booking.end_time) - hourOf(booking.start_time) + 24) % 24 || 24 : 1;
  const end = /^\d{2}:\d{2}$/.test(start) && hourOf(start) + length <= 24 ? pad(hourOf(start) + length) : "";
  const courtName = courts.find((c) => c.id === courtId)?.name ?? "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking) return;
    if (!courtId || !date || !end) return setError("Choose a court, a date and a start time on the hour.");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bookings/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: booking.id, courtId, date, startTime: start }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.error ?? "Could not move the booking. Please try again.");
      toast.success(`Moved to ${courtName} · ${formatShortDate(date)} · ${formatTime12h(start)}–${formatTime12h(end)}`);
      onMoved(booking.id, { court_id: courtId, booking_date: date, start_time: `${start}:00`, end_time: `${end}:00` }, courtName);
      onClose();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Move Booking</DialogTitle>
          <DialogDescription>
            {booking?.customer_name} · {booking?.courts?.name} · {booking && formatShortDate(booking.booking_date)},{" "}
            {booking && `${formatTime12h(booking.start_time)}–${formatTime12h(booking.end_time)}`}. The payment stays as it is, so
            the new slot must cost the same.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="move-court">Court</Label>
            <Select value={courtId} onValueChange={(v) => setCourtId(v ?? "")}>
              <SelectTrigger id="move-court">
                <SelectValue placeholder="Choose a court">{() => courtName || "Choose a court"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {courts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="move-date">Date</Label>
            <Input id="move-date" type="date" min={formatManilaDate()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="move-start">Start time</Label>
            <Input id="move-start" type="time" step={3600} value={start} onChange={(e) => setStart(e.target.value)} aria-describedby="move-end" />
            <p id="move-end" className="text-[11px] text-muted-foreground">
              {end
                ? `Ends at ${formatTime12h(end)} (same ${length}-hour length).`
                : `Keeps the same ${length}-hour length.`}
            </p>
          </div>
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move Booking
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
