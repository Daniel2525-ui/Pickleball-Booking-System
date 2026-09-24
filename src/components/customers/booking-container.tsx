"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slot } from "@/components/customers/types";
import { DateSelector } from "@/components/customers/date-selector";
import { CourtAvailabilityGrid } from "@/components/customers/court-availability-grid";
import { BookingModal } from "@/components/customers/booking-modal";
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service";
import { OperatingHour } from "@/components/admin/schedules/types";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { Court } from "@/lib/services/courts/courtsTypes";
import { fetchBookingsForDate, BookingSlot } from "@/lib/services/bookings/fetchBookingsForDate.service";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";

import { generateTimeSlots } from "@/lib/services/schedule/generateTimeSlots.service";
import { checkSlotAvailability } from "@/lib/services/bookings/checkSlotAvailability.service";
import { createCheckoutSession } from "@/lib/services/payments/createCheckoutSession.service";

export const BookingContainer = () => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBookingSuccess, setIsBookingSuccess] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [operatingHours, setOperatingHours] = useState<OperatingHour[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [bookings, setBookings] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Check auth state on mount
  useEffect(() => {
    const supabase = createClient();

    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load operating hours and courts on mount
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      const [hoursRes, courtsRes] = await Promise.all([
        fetchOperatingHours(),
        fetchCourtsData(),
      ]);
      if (hoursRes.data) setOperatingHours(hoursRes.data);
      if (courtsRes.data) {
        setCourts(courtsRes.data);
      }
      setLoading(false);
    };
    loadInitialData();
  }, []);

  // Load bookings when selected date changes
  useEffect(() => {
    const loadBookings = async () => {
      const { data } = await fetchBookingsForDate(selectedDate);
      setBookings(data);
    };
    loadBookings();
  }, [selectedDate]);

  const courtNames = useMemo(() => courts.map((c) => c.name), [courts]);

  const timeSlots = useMemo(
    () => generateTimeSlots(selectedDate, operatingHours),
    [operatingHours, selectedDate]
  );

  // Check if a slot is booked by comparing against real bookings
  const getSlotStatus = useCallback(
    (_date: Date, courtName: string, timeRange: string) => {
      return checkSlotAvailability(courtName, timeRange, courts, bookings);
    },
    [courts, bookings]
  );

  const handleSlotClick = (courtName: string, time: string) => {
    if (getSlotStatus(selectedDate, courtName, time) !== "available") return;

    // If not logged in, show login prompt
    if (!user) {
      setShowLoginPrompt(true);
      return;
    }

    const court = courts.find((c) => c.name === courtName);

    setSelectedSlot({
      date: selectedDate,
      court: courtName,
      time,
      price: court?.price || 200, // Read the dynamically attached price
    });
    setIsBookingSuccess(false);
    setIsDialogOpen(true);
  };

  const confirmBooking = async () => {
    if (!selectedSlot || !user) return;

    setIsCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const court = courts.find(c => c.name === selectedSlot.court);
      if (!court) throw new Error("Court not found");

      const url = await createCheckoutSession({
        courtId: court.id,
        courtName: court.name,
        date: selectedSlot.date,
        timeRange: selectedSlot.time,
      });

      window.location.href = url;
    } catch (err: any) {
      setCheckoutError(err.message || "An unexpected error occurred");
      setIsCheckoutLoading(false);
    }
  };

  const handleCloseAndReset = () => {
    setIsDialogOpen(false);
    setIsBookingSuccess(false);
    setCheckoutError(null);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 rounded-2xl border border-dashed text-muted-foreground text-sm">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Loading schedules...
      </div>
    );
  }

  return (
    <>
      <DateSelector
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        operatingHours={operatingHours}
      />

      {timeSlots.length > 0 ? (
        <CourtAvailabilityGrid
          selectedDate={selectedDate}
          courts={courtNames}
          timeSlots={timeSlots}
          onSlotClick={handleSlotClick}
          getSlotStatus={getSlotStatus}
        />
      ) : (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-muted-foreground text-sm">
          The venue is closed on this date. Please select another date.
        </div>
      )}

      <BookingModal
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        selectedSlot={selectedSlot}
        isBookingSuccess={isBookingSuccess}
        isLoading={isCheckoutLoading}
        error={checkoutError}
        onConfirm={confirmBooking}
        onCloseAndReset={handleCloseAndReset}
      />

      {/* Login Prompt Dialog */}
      <Dialog open={showLoginPrompt} onOpenChange={setShowLoginPrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Login Required</DialogTitle>
            <DialogDescription>
              You need to be logged in to book a court. Please log in or create an account to continue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-4">
            <Button variant="outline" onClick={() => setShowLoginPrompt(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button onClick={() => router.push("/login")} className="w-full sm:w-auto gap-2">
              <LogIn className="size-4" />
              Go to Login
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
