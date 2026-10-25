"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogIn, Calendar, Clock, X, CreditCard, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
import { BookingScheduleSkeleton } from "@/components/skeletons/booking-schedule-skeleton";
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service";
import { OperatingHour } from "@/components/admin/schedules/types";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { Court } from "@/lib/services/courts/courtsTypes";
import { fetchBookingsForDate, BookingSlot } from "@/lib/services/bookings/fetchBookingsForDate.service";
import { calculateCourtPrice } from "@/lib/services/courts/calculateCourtPrice.service";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";

import { generateTimeSlots } from "@/lib/services/schedule/generateTimeSlots.service";
import { checkSlotAvailability, getSlotBooking } from "@/lib/services/bookings/checkSlotAvailability.service";
import { createCheckoutSession } from "@/lib/services/payments/createCheckoutSession.service";
import { resumeBookingPayment } from "@/lib/services/bookings/resumeBookingPayment.service";
import { cancelBooking } from "@/lib/services/bookings/cancelBooking.service";

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
  const [isFetchingBookings, setIsFetchingBookings] = useState(false);
  const [showMobileCalendar, setShowMobileCalendar] = useState(false);
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

  const [pendingBookingToResume, setPendingBookingToResume] = useState<{
    bookingId: string;
    courtName: string;
    time: string;
    date: Date;
  } | null>(null);
  const [isResumingGridBooking, setIsResumingGridBooking] = useState(false);
  const [isCancellingGridBooking, setIsCancellingGridBooking] = useState(false);

  // Load bookings when selected date changes
  const refreshBookings = useCallback(async () => {
    setIsFetchingBookings(true);
    const { data } = await fetchBookingsForDate(selectedDate);
    setBookings(data);
    setIsFetchingBookings(false);
  }, [selectedDate]);

  useEffect(() => {
    refreshBookings();
  }, [refreshBookings]);

  const courtNames = useMemo(() => courts.map((c) => c.name), [courts]);

  const timeSlots = useMemo(
    () => generateTimeSlots(selectedDate, operatingHours),
    [operatingHours, selectedDate]
  );

  // Check if a slot is booked by comparing against real bookings
  const getSlotStatus = useCallback(
    (_date: Date, courtName: string, timeRange: string) => {
      return checkSlotAvailability(courtName, timeRange, courts, bookings, _date, user?.id);
    },
    [courts, bookings, user?.id]
  );

  // Calculate maximum consecutive available hours (1 to 3) starting at slotTime for courtName
  const getMaxAvailableDuration = useCallback(
    (courtName: string, slotTime: string): number => {
      const startIndex = timeSlots.indexOf(slotTime);
      if (startIndex === -1) return 1;

      let maxHours = 1;
      for (let h = 2; h <= 3; h++) {
        const nextSlot = timeSlots[startIndex + h - 1];
        if (!nextSlot) break;
        const status = getSlotStatus(selectedDate, courtName, nextSlot);
        if (status !== "available") break;
        maxHours = h;
      }
      return maxHours;
    },
    [timeSlots, selectedDate, getSlotStatus]
  );

  const setSlotWithDuration = (courtName: string, startSlotTime: string, duration: number) => {
    const startIndex = timeSlots.indexOf(startSlotTime);
    if (startIndex === -1) return;

    const startPart = startSlotTime.split(" - ")[0].trim();
    const endSlot = timeSlots[startIndex + duration - 1];
    if (!endSlot) return;
    const endPart = endSlot.split(" - ")[1].trim();

    const formattedRange = `${startPart} - ${endPart}`;
    const price = calculateCourtPrice(duration);

    setSelectedSlot({
      date: selectedDate,
      court: courtName,
      time: formattedRange,
      price,
      duration,
      startSlot: startSlotTime,
    });
    setIsBookingSuccess(false);
  };

  const handleSlotClick = (courtName: string, time: string) => {
    const status = getSlotStatus(selectedDate, courtName, time);

    // If user clicked their own pending slot, allow them to resume or cancel
    if (status === "user_pending") {
      const slotBooking = getSlotBooking(courtName, time, courts, bookings);
      if (slotBooking?.id) {
        setPendingBookingToResume({
          bookingId: slotBooking.id,
          courtName,
          time,
          date: selectedDate,
        });
        return;
      }
    }

    if (status !== "available") return;

    // If not logged in, show login prompt
    if (!user) {
      setShowLoginPrompt(true);
      return;
    }

    // If clicking on an already selected court
    if (selectedSlot && selectedSlot.court === courtName) {
      const startSlot = selectedSlot.startSlot || selectedSlot.time;
      const startIndex = timeSlots.indexOf(startSlot);
      const clickedIndex = timeSlots.indexOf(time);

      // If clicked the exact start slot and duration is 1, deselect
      if (startSlot === time && (selectedSlot.duration || 1) === 1) {
        setSelectedSlot(null);
        return;
      }

      // If clicked consecutive hour right after currently selected duration, expand
      const currentDur = selectedSlot.duration || 1;
      if (clickedIndex === startIndex + currentDur && currentDur < 3) {
        const maxDur = getMaxAvailableDuration(courtName, startSlot);
        if (maxDur >= currentDur + 1) {
          setSlotWithDuration(courtName, startSlot, currentDur + 1);
          return;
        }
      }

      // If clicked within the currently selected range, deselect
      if (clickedIndex >= startIndex && clickedIndex < startIndex + currentDur) {
        setSelectedSlot(null);
        return;
      }
    }

    // Default: select this slot as starting slot with duration 1
    setSlotWithDuration(courtName, time, 1);
  };

  const handleResumeGridBooking = async () => {
    if (!pendingBookingToResume || isResumingGridBooking) return;
    setIsResumingGridBooking(true);
    toast.loading("Preparing checkout session...", { id: "resume-grid-booking" });

    const { url, error } = await resumeBookingPayment(pendingBookingToResume.bookingId);
    if (error || !url) {
      toast.error(error?.message || "Failed to resume payment.", { id: "resume-grid-booking" });
      setIsResumingGridBooking(false);
      await refreshBookings();
    } else {
      toast.success("Redirecting to Stripe checkout...", { id: "resume-grid-booking" });
      window.location.href = url;
    }
  };

  const handleCancelGridBooking = async () => {
    if (!pendingBookingToResume || isCancellingGridBooking) return;
    setIsCancellingGridBooking(true);

    const { error } = await cancelBooking(pendingBookingToResume.bookingId);
    if (error) {
      toast.error(error.message || "Failed to cancel reservation.");
    } else {
      toast.success("Court reservation cancelled. The slot is now available.");
      setPendingBookingToResume(null);
      await refreshBookings();
    }
    setIsCancellingGridBooking(false);
  };

  const confirmBooking = async () => {
    if (!selectedSlot || !user) return;

    setIsCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const court = courts.find(court => court.name === selectedSlot.court);
      if (!court) throw new Error("Court not found");

      const url = await createCheckoutSession({
        courtId: court.id,
        courtName: court.name,
        date: selectedSlot.date,
        timeRange: selectedSlot.time,
      });

      window.location.assign(url);
    } catch (err: unknown) {
      setCheckoutError((err as Error).message || "An unexpected error occurred");
      setIsCheckoutLoading(false);
      await refreshBookings();
    }
  };

  const handleCloseAndReset = () => {
    setIsDialogOpen(false);
    setIsBookingSuccess(false);
    setCheckoutError(null);
  };

  return loading ? (
    <BookingScheduleSkeleton />
  ) : (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Mobile Quick-Date Strip */}
        <div className="lg:hidden col-span-1 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const d = new Date(selectedDate);
                d.setDate(d.getDate() - 1);
                const today = new Date(); today.setHours(0,0,0,0);
                if (d >= today) setSelectedDate(d);
              }}
              className="size-9 shrink-0 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
              aria-label="Previous day"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex-1 overflow-x-auto scrollbar-none">
              <div className="flex gap-1.5 pb-1">
                {Array.from({ length: 7 }).map((_, i) => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() + i);
                  const isSelected = d.toDateString() === selectedDate.toDateString();
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(d)}
                      className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-md"
                          : "bg-card border border-border hover:border-primary/40"
                      }`}
                    >
                      <span className="text-[10px] uppercase tracking-wider opacity-80">
                        {i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString("en-US", { weekday: "short" })}
                      </span>
                      <span className="text-sm font-bold mt-0.5">{d.getDate()}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => {
                const d = new Date(selectedDate);
                d.setDate(d.getDate() + 1);
                setSelectedDate(d);
              }}
              className="size-9 shrink-0 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
              aria-label="Next day"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </span>
            <button
              type="button"
              onClick={() => setShowMobileCalendar((prev) => !prev)}
              className="text-primary hover:underline font-semibold flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-primary/10 transition-colors"
            >
              <Calendar className="size-3.5" />
              <span>{showMobileCalendar ? "Hide Calendar" : "Pick Other Date"}</span>
            </button>
          </div>

          {showMobileCalendar && (
            <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-200">
              <DateSelector
                selectedDate={selectedDate}
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setShowMobileCalendar(false);
                }}
                operatingHours={operatingHours}
              />
            </div>
          )}
        </div>

        <div className="hidden lg:block lg:col-span-4 xl:col-span-3">
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
                isFetching={isFetchingBookings}
              />

              {/* Selected Slot Summary */}
              {selectedSlot && (
                <div className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:w-[90%] sm:max-w-4xl z-50 bg-card border-t sm:border sm:rounded-2xl shadow-[0_-15px_40px_-15px_rgba(0,0,0,0.15)] sm:shadow-2xl p-4 sm:p-5 md:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6 animate-in slide-in-from-bottom-8 duration-300">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 sm:hidden text-muted-foreground size-8"
                    onClick={() => setSelectedSlot(null)}
                    aria-label="Deselect court slot"
                  >
                    <X className="size-4" />
                  </Button>
                  <div className="w-full sm:w-auto pr-8 sm:pr-0">
                    <div className="flex items-center justify-between sm:justify-start gap-4 mb-1 sm:mb-2">
                      <h3 className="text-xs sm:text-sm font-bold text-muted-foreground uppercase tracking-wider">Selected Slot</h3>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-6">
                      <p className="text-lg sm:text-xl font-black text-foreground">{selectedSlot.court}</p>
                      <div className="flex items-center text-xs sm:text-sm font-medium gap-1.5">
                        <Calendar className="size-3.5 sm:size-4 text-primary" />
                        <span className="font-bold">
                          {selectedSlot.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <div className="flex items-center text-xs sm:text-sm font-medium gap-1.5">
                        <Clock className="size-3.5 sm:size-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                          {selectedSlot.time}
                        </span>
                      </div>
                    </div>
                    {/* Duration Selection Pills */}
                    <div className="flex items-center gap-2 mt-2.5">
                      <span className="text-xs font-semibold text-muted-foreground">Duration:</span>
                      <div className="flex items-center gap-1.5">
                        {[1, 2, 3].map((hours) => {
                          const startSlot = selectedSlot.startSlot || selectedSlot.time;
                          const maxAvailable = getMaxAvailableDuration(selectedSlot.court, startSlot);
                          const isAvailable = hours <= maxAvailable;
                          const isCurrent = (selectedSlot.duration || 1) === hours;

                          return (
                            <button
                              key={hours}
                              type="button"
                              disabled={!isAvailable}
                              onClick={() => setSlotWithDuration(selectedSlot.court, startSlot, hours)}
                              title={isAvailable ? `${hours} hour${hours > 1 ? "s" : ""} (₱${calculateCourtPrice(hours)})` : "Consecutive slot unavailable"}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                isCurrent
                                  ? "bg-primary text-primary-foreground shadow-xs"
                                  : isAvailable
                                  ? "bg-muted hover:bg-muted/80 text-foreground border border-border"
                                  : "opacity-35 cursor-not-allowed bg-muted/40 text-muted-foreground border border-border/40"
                              }`}
                            >
                              {hours} {hours === 1 ? "hr" : "hrs"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/60">
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] text-muted-foreground">
                        Total Price {(selectedSlot.duration || 1) > 1 ? `(${selectedSlot.duration} hrs × ₱200)` : "(₱200 / hr)"}
                      </p>
                      <p className="text-xl sm:text-2xl font-black text-foreground">₱{selectedSlot.price.toLocaleString()}</p>
                    </div>
                    <Button
                      onClick={() => setIsDialogOpen(true)}
                      size="lg"
                      className="min-h-[44px] sm:min-h-[48px] px-6 text-sm font-bold shadow-md hover:shadow-lg transition-all"
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

      {/* Resume Pending Booking Dialog */}
      <Dialog
        open={pendingBookingToResume !== null}
        onOpenChange={(open) => {
          if (!open && !isResumingGridBooking && !isCancellingGridBooking) {
            setPendingBookingToResume(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!isResumingGridBooking && !isCancellingGridBooking}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Clock className="size-5 text-amber-500" />
              Resume Court Reservation
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              You currently have an unfinished pending reservation for this court slot held under your account.
            </DialogDescription>
          </DialogHeader>

          {pendingBookingToResume && (
            <div className="bg-muted/50 border border-border p-4 rounded-xl space-y-2.5 text-sm my-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground text-base">{pendingBookingToResume.courtName}</span>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  Pending Payment
                </span>
              </div>
              <div className="flex items-center text-muted-foreground gap-2">
                <Calendar className="size-4 text-primary shrink-0" />
                <span>
                  {pendingBookingToResume.date.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex items-center text-muted-foreground gap-2">
                <Clock className="size-4 text-primary shrink-0" />
                <span>{pendingBookingToResume.time}</span>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
            <Button
              variant="outline"
              onClick={handleCancelGridBooking}
              disabled={isCancellingGridBooking || isResumingGridBooking}
              className="w-full sm:w-auto text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive font-semibold text-xs"
            >
              {isCancellingGridBooking ? (
                <LoaderCircle className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <XCircle className="size-3.5 mr-1.5" />
              )}
              {isCancellingGridBooking ? "Cancelling..." : "Cancel Reservation"}
            </Button>
            <Button
              onClick={handleResumeGridBooking}
              disabled={isCancellingGridBooking || isResumingGridBooking}
              className="w-full sm:w-auto font-bold text-xs gap-1.5 shadow-sm"
            >
              {isResumingGridBooking ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <CreditCard className="size-3.5" />
              )}
              {isResumingGridBooking ? "Connecting to Stripe..." : "Continue to Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
