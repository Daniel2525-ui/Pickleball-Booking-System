"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogIn, Calendar, Clock, X } from "lucide-react";
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
      return checkSlotAvailability(courtName, timeRange, courts, bookings, _date)
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

    // Unselect if clicking the already selected slot
    if (selectedSlot?.court === courtName && selectedSlot?.time === time) {
      setSelectedSlot(null);
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 xl:col-span-3">
          <DateSelector
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            operatingHours={operatingHours}
          />
        </div>

        <div className="lg:col-span-8 xl:col-span-9">
          {timeSlots.length > 0 ? (
            <div className="space-y-6">
              <CourtAvailabilityGrid
                selectedDate={selectedDate}
                courts={courtNames}
                timeSlots={timeSlots}
                onSlotClick={handleSlotClick}
                getSlotStatus={getSlotStatus}
                selectedSlot={selectedSlot}
              />

              {/* Selected Slot Summary */}
              {selectedSlot && (
                <div className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:w-[90%] sm:max-w-4xl z-50 bg-card border-t sm:border sm:rounded-2xl shadow-[0_-15px_40px_-15px_rgba(0,0,0,0.15)] sm:shadow-2xl p-4 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6 animate-in slide-in-from-bottom-8 duration-300">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 sm:hidden text-muted-foreground"
                    onClick={() => setSelectedSlot(null)}
                  >
                    <X className="size-4" />
                  </Button>
                  <div className="w-full sm:w-auto pr-8 sm:pr-0">
                    <div className="flex items-center justify-between sm:justify-start gap-4 mb-2">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Selected Slot</h3>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                      <p className="text-xl font-bold text-foreground">{selectedSlot.court}</p>
                      <div className="flex items-center text-sm font-medium gap-1.5">
                        <Calendar className="size-4" />
                        <span className="font-bold">
                          {selectedSlot.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <div className="flex items-center text-sm font-medium text-muted-foreground gap-1.5">
                        <Clock className="size-4 text-green-600 dark:text-green-400 font-medium" />
                        <span className="text-green-600 dark:text-green-400 font-medium">
                          {selectedSlot.time}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:items-end w-full sm:w-auto gap-3">
                    <div className="text-left sm:text-right">
                      <p className="text-xs text-muted-foreground">Total Price</p>
                      <p className="text-2xl font-bold text-foreground">₱{selectedSlot.price.toLocaleString()}</p>
                    </div>
                    <Button
                      onClick={() => setIsDialogOpen(true)}
                      size="lg"
                      className="w-full sm:w-auto shadow-md hover:shadow-lg transition-all"
                    >
                      Continue to Checkout
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-muted-foreground text-sm">
              The venue is closed on this date. Please select another date.
            </div>
          )}
        </div>
      </div>

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
