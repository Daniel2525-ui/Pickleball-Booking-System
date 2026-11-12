"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogIn, Calendar, Clock, CreditCard, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
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
import { supabase as browserSupabase } from "@/lib/supabase";
import { fetchPricing } from "@/lib/services/pricing/fetchPricing.service";
import { quoteCourtPrice, type Pricing } from "@/lib/services/pricing/quoteCourtPrice";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";

import { generateTimeSlots } from "@/lib/services/schedule/generateTimeSlots.service";
import { fetchUpcomingClosures, VenueClosure } from "@/lib/services/schedule/venueClosures.service";
import { formatManilaDate, lateNightLabel } from "@/lib/utils/bookingTime";
import { formatTime12h } from "@/lib/utils/formatTime";
import { checkSlotAvailability, getSlotBooking, slotTimes } from "@/lib/services/bookings/checkSlotAvailability.service";
import { createCheckoutSession } from "@/lib/services/payments/createCheckoutSession.service";
import { resumeBookingPayment } from "@/lib/services/bookings/resumeBookingPayment.service";
import { cancelBooking } from "@/lib/services/bookings/cancelBooking.service";
import { BasketSheet, BASKET_SHEET_PADDING } from "@/components/customers/basket-sheet";
import { lineKey, mergeSpans, removeLine, splitTakenLines } from "@/lib/services/bookings/basket";
import { BookingCountdown } from "@/components/customers/booking-countdown";
import { CourtRally } from "@/components/customers/court-rally";
import { compactRange } from "@/lib/services/bookings/quickStarts";

// A guest's basket survives the trip to /login (this tab only); restored once they are signed in
const PENDING_BASKET_KEY = "crosshair:pending-basket";

export const BookingContainer = () => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [selectedDate, setSelectedDateRaw] = useState<Date>(new Date());
  const [basket, setBasket] = useState<Slot[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [operatingHours, setOperatingHours] = useState<OperatingHour[]>([]);
  const [closures, setClosures] = useState<VenueClosure[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
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
      if (!user) return;

      let saved: { date: string; lines: Omit<Slot, "date">[] } | null = null;
      try {
        saved = JSON.parse(sessionStorage.getItem(PENDING_BASKET_KEY) ?? "null");
        sessionStorage.removeItem(PENDING_BASKET_KEY);
      } catch {
        return;
      }
      if (!saved?.lines?.length) return;
      const date = new Date(saved.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (isNaN(date.getTime()) || new Date(date).setHours(0, 0, 0, 0) < today.getTime()) return;
      // Availability is re-checked by the checkout API; a taken court is dropped from the basket there
      setSelectedDateRaw(date);
      setBasket(saved.lines.map((line) => ({ ...line, date })));
      setIsDialogOpen(true);
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
      const [hoursRes, courtsRes, pricingRes, closuresRes] = await Promise.all([
        fetchOperatingHours(),
        fetchCourtsData(),
        fetchPricing(browserSupabase),
        fetchUpcomingClosures(),
      ]);
      setClosures(closuresRes.data);
      if (hoursRes.data) setOperatingHours(hoursRes.data);
      if (pricingRes.data) setPricing(pricingRes.data);
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
    holdExpiresAt?: string | null;
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
    let ignore = false;
    fetchBookingsForDate(selectedDate).then(({ data }) => {
      if (!ignore) {
        setBookings(data);
        setIsFetchingBookings(false);
      }
    });
    return () => {
      ignore = true;
    };
  }, [selectedDate]);

  // A basket belongs to one date, so switching dates clears it
  const setSelectedDate = (d: Date) => {
    if (d.toDateString() === selectedDate.toDateString()) return;
    if (basket.length > 0) {
      setBasket([]);
      toast.info("Selection cleared for the new date.");
    }
    setSelectedDateRaw(d);
  };

  const courtNames = useMemo(() => courts.map((c) => c.name), [courts]);

  // A closed date (venue_closures) closes its business day: its own hours and the late night it would leave on
  // the next date. The database refuses customer bookings on it too.
  const selectedDateStr = formatManilaDate(selectedDate);
  const closure = closures.find((c) => c.closed_on === selectedDateStr);
  const timeSlots = useMemo(
    () => generateTimeSlots(selectedDate, operatingHours, closures.map((c) => c.closed_on)),
    [operatingHours, selectedDate, closures]
  );
  // Slot indexes that start after a gap (late-night hours end, the morning opens): a booking never spans one
  const breaks = useMemo(
    () => new Set(timeSlots.flatMap((t, i) => (i > 0 && slotTimes(timeSlots[i - 1]).end !== slotTimes(t).start ? [i] : []))),
    [timeSlots]
  );

  // Check if a slot is booked by comparing against real bookings
  const getSlotStatus = useCallback(
    (_date: Date, courtName: string, timeRange: string) => {
      return checkSlotAvailability(courtName, timeRange, courts, bookings, _date, user?.id);
    },
    [courts, bookings, user?.id]
  );

  // Admin-configured booking length (booking_settings); the database enforces the same limits
  const minHours = pricing?.settings.min_hours ?? 1;
  const priceFor = (date: Date, startSlotTime: string, duration: number) => {
    if (!pricing) return { total: 0, hasPeak: false };
    return quoteCourtPrice(pricing, formatManilaDate(date), slotTimes(startSlotTime).start, duration);
  };

  // [first, past-last) slot indexes a basket line covers
  const lineSpan = useCallback((l: Slot) => {
    const start = timeSlots.indexOf(l.startSlot || l.time);
    return [start, start + (l.duration || 1)] as const;
  }, [timeSlots]);

  // Consecutive free hours from slotTime on courtName (no maximum length); other basket lines on that court
  // count as taken, so separate times on one court never overlap. `skipKey` is the line being resized.
  const getMaxAvailableDuration = useCallback(
    (courtName: string, slotTime: string, skipKey?: string): number => {
      const startIndex = timeSlots.indexOf(slotTime);
      if (startIndex === -1) return 0;
      const picked = basket
        .filter((l) => l.court === courtName && lineKey(l) !== skipKey)
        .map(lineSpan);

      let hours = 0;
      for (let i = startIndex; i < timeSlots.length; i++) {
        const slot = timeSlots[i];
        if (!slot || getSlotStatus(selectedDate, courtName, slot) !== "available") break;
        if (i > startIndex && breaks.has(i)) break;
        if (picked.some(([s, e]) => i >= s && i < e)) break;
        hours++;
      }
      return hours;
    },
    [timeSlots, breaks, selectedDate, getSlotStatus, basket, lineSpan]
  );

  // A basket line for courtName covering `duration` slots from slot index `start`
  const makeLine = (courtName: string, start: number, duration: number): Slot => {
    const startSlot = timeSlots[start];
    const { total: price, hasPeak } = priceFor(selectedDate, startSlot, duration);
    return {
      date: selectedDate,
      court: courtName,
      time: `${startSlot.split(" - ")[0].trim()} - ${timeSlots[start + duration - 1].split(" - ")[1].trim()}`,
      price,
      hasPeak,
      duration,
      startSlot,
    };
  };

  // Replaces one court's ranges; touching ranges merge into one line
  const setCourtSpans = (courtName: string, spans: (readonly [number, number])[]) => {
    const lines = mergeSpans(spans, breaks).map(([s, e]) => makeLine(courtName, s, e - s));
    setBasket((prev) => [...prev.filter((l) => l.court !== courtName), ...lines]);
  };
  const spansOn = (courtName: string) => basket.filter((l) => l.court === courtName).map(lineSpan);

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
          holdExpiresAt: slotBooking.hold_expires_at,
        });
        return;
      }
    }

    if (status !== "available") return;

    // A court can hold several separate times; each is its own basket line
    const onCourt = basket.filter((l) => l.court === courtName);
    const clickedIndex = timeSlots.indexOf(time);

    // Tapping inside a picked range removes that range
    const inside = onCourt.find((l) => {
      const [s, e] = lineSpan(l);
      return clickedIndex >= s && clickedIndex < e;
    });
    if (inside) {
      setBasket((prev) => removeLine(prev, lineKey(inside)));
      return;
    }

    // Tapping the hour right after a range adds that hour to it
    const before = breaks.has(clickedIndex) ? undefined : onCourt.find((l) => lineSpan(l)[1] === clickedIndex);
    if (before) {
      setCourtSpans(courtName, [...spansOn(courtName), [clickedIndex, clickedIndex + 1]]);
      return;
    }

    // Otherwise this starts a new range at the shortest allowed duration; one touching another range merges with it
    if (getMaxAvailableDuration(courtName, time) < minHours) {
      toast.error(`Bookings need at least ${minHours} consecutive free hours from this start time.`);
      return;
    }
    setCourtSpans(courtName, [...spansOn(courtName), [clickedIndex, clickedIndex + minHours]]);
  };

  // Guests build a basket freely and sign in only to pay
  const startCheckout = (lines: Slot[] = basket) => {
    setBasket(lines);
    if (user) {
      setIsDialogOpen(true);
      return;
    }
    try {
      sessionStorage.setItem(
        PENDING_BASKET_KEY,
        JSON.stringify({ date: selectedDate.toISOString(), lines })
      );
    } catch {
      // Storage blocked (private mode): the guest just picks again after signing in
    }
    setShowLoginPrompt(true);
  };

  const openHours = courtNames.reduce(
    (n, court) => n + timeSlots.filter((time) => getSlotStatus(selectedDate, court, time) === "available").length,
    0
  );
  const isToday = selectedDate.toDateString() === new Date().toDateString();
  const dayName = selectedDate.toLocaleDateString("en-US", { weekday: "long" });
  // The day's own closing time when it has one (2 AM for a late close, not the midnight its last slot here ends at)
  const ownClose = operatingHours.find((h) => h.day_of_week === dayName && h.is_open)?.close_time;
  const closesAt = timeSlots.length === 0 ? undefined : ownClose && !closure ? formatTime12h(ownClose) : timeSlots.at(-1)!.split(" - ")[1];
  const slotWord = openHours === 1 ? "slot" : "slots";
  // Warn once free slots drop to half the court count (4 courts → 2, 6 → 3)
  const goingFast = openHours > 0 && openHours <= Math.ceil(courtNames.length / 2);
  const myHold = user
    ? courtNames.flatMap((court) => timeSlots.filter((time) => getSlotStatus(selectedDate, court, time) === "user_pending").map((time) => ({ court, time })))[0]
    : undefined;


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
      toast.success("Redirecting to payment...", { id: "resume-grid-booking" });
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
    if (basket.length === 0 || !user) return;

    setIsCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const lines = basket.map((line) => {
        const court = courts.find((c) => c.name === line.court);
        if (!court) throw new Error("Court not found");
        return { courtId: court.id, timeRange: line.time };
      });

      const url = await createCheckoutSession({ date: basket[0].date, lines });

      window.location.assign(url);
    } catch (err: unknown) {
      setCheckoutError((err as Error).message || "An unexpected error occurred");
      setIsCheckoutLoading(false);
      // Drop courts someone else took meanwhile, or every retry fails with the same 409
      const { data: fresh } = await fetchBookingsForDate(selectedDate);
      setBookings(fresh);
      const { kept, dropped } = splitTakenLines(basket, (line) => {
        const start = timeSlots.indexOf(line.startSlot || line.time);
        return Array.from({ length: line.duration || 1 }, (_, i) => timeSlots[start + i]).every(
          (slot) => slot && checkSlotAvailability(line.court, slot, courts, fresh, selectedDate, user.id) === "available"
        );
      });
      if (dropped.length > 0) {
        setBasket(kept);
        toast.error(`Removed from your selection (no longer available): ${dropped.map((l) => l.court).join(", ")}.`);
      }
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6 md:gap-10 items-end pb-8">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-primary">
            <span className="size-2 rounded-full bg-primary animate-pulse" aria-hidden />
            {loading
              ? "Live availability"
              : `${isToday ? "Live · " : ""}${selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${closesAt ? ` · open till ${closesAt}` : " · closed"}`}
          </p>
          <h1 className="mt-3 text-5xl sm:text-7xl lg:text-8xl leading-[0.88] text-balance">
            {loading ? (
              "Book a court"
            ) : timeSlots.length === 0 ? (
              `Closed on ${dayName}`
            ) : openHours === 0 ? (
              <>
                <span className="text-primary">Fully booked</span> {isToday ? "tonight" : `on ${dayName}`}
              </>
            ) : goingFast ? (
              <>
                Only <span className="text-primary tabular-nums">{openHours} {slotWord}</span> left {isToday ? "tonight" : `on ${dayName}`}
              </>
            ) : (
              <>
                <span className="text-primary tabular-nums">{openHours}</span> {slotWord} open {isToday ? "today" : `on ${dayName}`}
              </>
            )}
          </h1>
          {!loading && timeSlots.length > 0 && goingFast && (
            <span className="mt-4 inline-block text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Going fast
            </span>
          )}
          <p className="mt-4 text-muted-foreground font-semibold max-w-md leading-relaxed">
            Tap a free slot on any court, tap the next hour to extend, then check out.
          </p>
        </div>
        <CourtRally className="w-full max-w-sm md:max-w-none justify-self-center" />
      </div>

      {loading ? (
        <BookingScheduleSkeleton />
      ) : (
      <div className="flex flex-col gap-4">
          {myHold && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm">
              <span>
                You have an unpaid hold on <b>{myHold.court}</b>, {compactRange([myHold.time], 0, 1)}. Pay before it expires.
              </span>
              <Button size="sm" className="font-bold" onClick={() => handleSlotClick(myHold.court, myHold.time)}>
                Resume
              </Button>
            </div>
          )}
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
            <div className={`space-y-6 ${basket.length > 0 ? BASKET_SHEET_PADDING : ""}`}>
              <CourtAvailabilityGrid
                selectedDate={selectedDate}
                courts={courtNames}
                timeSlots={timeSlots}
                onSlotClick={handleSlotClick}
                getSlotStatus={getSlotStatus}
                selectedSlots={basket}
                isFetching={isFetchingBookings}
                priceOf={(time) => priceFor(selectedDate, time, 1).total}
                headingOf={(time) => lateNightLabel(selectedDateStr, slotTimes(time).start, pricing?.settings.day_ends_at) ?? dayName}
              />

              {pricing && (
                <BasketSheet
                  lines={basket}
                  pricing={pricing}
                  getMaxDuration={(line) => getMaxAvailableDuration(line.court, line.startSlot || line.time, lineKey(line))}
                  onDuration={(line, hours) => {
                    const [start] = lineSpan(line);
                    setCourtSpans(line.court, [...basket.filter((l) => l.court === line.court && lineKey(l) !== lineKey(line)).map(lineSpan), [start, start + hours]]);
                  }}
                  onRemove={(line) => setBasket((prev) => removeLine(prev, lineKey(line)))}
                  onCheckout={() => startCheckout()}
                />
              )}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-muted-foreground text-sm">
              {closure?.reason
                ? `The venue is closed on this date (${closure.reason}). Please select another date.`
                : "The venue is closed on this date. Please select another date."}
            </div>
          )}
        </div>
      </div>
      </div>
      )}

      <BookingModal
        isOpen={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setCheckoutError(null);
        }}
        lines={basket}
        isLoading={isCheckoutLoading}
        error={checkoutError}
        onConfirm={confirmBooking}
      />

      {/* Login Prompt Dialog */}
      <Dialog open={showLoginPrompt} onOpenChange={setShowLoginPrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign in to pay</DialogTitle>
            <DialogDescription>
              Your {basket.length === 1 ? "court stays" : "courts stay"} selected while you sign in or create an account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
            <Button variant="ghost" onClick={() => setShowLoginPrompt(false)} className="w-full sm:w-auto">
              Keep browsing
            </Button>
            <Button variant="outline" onClick={() => router.push("/register")} className="w-full sm:w-auto">
              Create account
            </Button>
            <Button onClick={() => router.push("/login")} className="w-full sm:w-auto gap-2">
              <LogIn className="size-4" />
              Sign in
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
              <BookingCountdown
                variant="dialog"
                bookingId={pendingBookingToResume.bookingId}
                holdExpiresAt={pendingBookingToResume.holdExpiresAt}
                status="pending"
                onStatusChange={async () => {
                  await refreshBookings();
                  setPendingBookingToResume(null);
                }}
              />
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
