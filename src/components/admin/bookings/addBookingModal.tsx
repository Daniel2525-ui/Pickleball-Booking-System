"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAdminBooking } from "@/lib/services/bookings/createAdminBooking.service";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { fetchCustomers } from "@/lib/services/customers/fetchCustomers.service";
import { Court } from "@/lib/services/courts/courtsTypes";
import { Customer } from "@/lib/services/customers/customersTypes";

interface AddBookingModalProps {
  onBookingAdded: () => void;
}

export const AddBookingModal = ({ onBookingAdded }: AddBookingModalProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [courts, setCourts] = useState<Court[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [userId, setUserId] = useState("");
  const [courtId, setCourtId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open) {
      fetchCourtsData().then((res) => setCourts(res.data || []));
      fetchCustomers().then((res) => setCustomers(res.data || []));
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userId || !courtId || !date || !startTime || !endTime || !amount) {
      setError("All fields are required. Please complete all reservation details.");
      return;
    }

    setLoading(true);
    setError(null);

    const { error: submitError } = await createAdminBooking(
      userId,
      courtId,
      date,
      startTime,
      endTime,
      Number(amount)
    );

    setLoading(false);

    if (submitError) {
      setError((submitError as any).message || "Failed to create booking.");
    } else {
      setOpen(false);
      setUserId("");
      setCourtId("");
      setDate("");
      setStartTime("");
      setEndTime("");
      setAmount("");
      onBookingAdded();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="w-full sm:w-auto gap-2 font-bold text-xs sm:text-sm shadow-sm hover:shadow">
            <Plus className="h-4 w-4" />
            New Reservation
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Record Manual Reservation</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Manually log a phone reservation or walk-in player into the court schedule.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {/* Select Player */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground">Select Player</Label>
            <Select value={userId} onValueChange={(value) => setUserId(value as string)}>
              <SelectTrigger className="h-9 text-xs sm:text-sm">
                <SelectValue placeholder="Choose a registered player" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id} className="text-xs sm:text-sm">
                    {customer.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Assigned Court */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground">Assigned Court</Label>
            <Select value={courtId} onValueChange={(value) => setCourtId(value as string)}>
              <SelectTrigger className="h-9 text-xs sm:text-sm">
                <SelectValue placeholder="Choose a court" />
              </SelectTrigger>
              <SelectContent>
                {courts.map((court) => (
                  <SelectItem key={court.id} value={court.id} className="text-xs sm:text-sm">
                    {court.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reservation Date */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground">Reservation Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 text-xs sm:text-sm"
            />
          </div>

          {/* Times Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-foreground">Start Time</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-9 text-xs sm:text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-foreground">End Time</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-9 text-xs sm:text-sm"
              />
            </div>
          </div>

          {/* Court Fee */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground">Court Fee (₱ PHP)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 200"
              className="h-9 text-xs sm:text-sm"
            />
          </div>

          <DialogFooter className="mt-4 pt-2 border-t">
            <Button
              type="submit"
              disabled={loading}
              className="w-full sm:w-auto font-bold text-xs sm:text-sm gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                "Record Reservation"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
