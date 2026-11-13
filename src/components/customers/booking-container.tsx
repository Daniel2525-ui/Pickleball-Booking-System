"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Calendar, Clock, QrCode, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
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
import { CourtAvailabilityGrid, GridLegend } from "@/components/customers/court-availability-grid";
import { VenueClosed } from "@/components/customers/venue-closed";
import { BookingModal, type CheckoutDetails } from "@/components/customers/booking-modal";
import { maxPlayers } from "@/lib/services/bookings/guestDetails";
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
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { bookingToday } from "@/lib/services/schedule/hoursRules";
import { formatTime12h } from "@/lib/utils/formatTime";
import { checkSlotAvailability, getSlotBooking, slotTimes } from "@/lib/services/bookings/checkSlotAvailability.service";
import { createCheckoutSession } from "@/lib/services/payments/createCheckoutSession.service";
import { resumeBookingPayment } from "@/lib/services/bookings/resumeBookingPayment.service";
import { cancelBooking } from "@/lib/services/bookings/cancelBooking.service";
import { BasketSheet, BASKET_SHEET_PADDING } from "@/components/customers/basket-sheet";
import { lineKey, mergeSpans, midnightIndex, removeLine, splitAtMidnight, splitTakenLines } from "@/lib/services/bookings/basket";
import { BookingCountdown } from "@/components/customers/booking-countdown";
import { compactRange } from "@/lib/services/bookings/quickStarts";

// A guest's basket survives the trip to /login (this tab only); restored once they are signed in
const PENDING_BASKET_KEY = "crosshair:pending-basket";

// A YYYY-MM-DD date as local midnight, like the day strip's dates
const dayStart = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const plusDays = (d: Date, days: number) => {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
};
// A day's bookings and the next date's, where its after-midnight hours are stored
const fetchBusinessDay = (d: Date) => Promise.all([fetchBookingsForDate(d), fetchBookingsForDate(plusDays(d, 1))]);

export const BookingContainer = () => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [selectedDate, setSelectedDateRaw] = useState<Date>(new Date());
  const [basket, setBasket] = useState<Slot[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [operatingHours, setOperatingHours] = useState<OperatingHour[]>([]);
  const [closures, setClosures] = useState<VenueClosure[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [bookings, setBookings] = useState<BookingSlot[]>([]);
  // The next date's bookings: they hold this day's after-midnight hours
  const [tailBookings, setTailBookings] = useState<BookingSlot[]>([]);
  // Set when a saved basket picks the date, so the business-day default below doesn't move it
  const restoredDate = useRef(false);
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
      // Yesterday may still be the business day (after midnight); the checkout API refuses hours already past
      const yesterday = plusDays(new Date(), -1);
      yesterday.setHours(0, 0, 0, 0);
      if (isNaN(date.getTime()) || new Date(date).setHours(0, 0, 0, 0) < yesterday.getTime()) return;
      // Availability is re-checked by the checkout API; a taken court is dropped from the basket there
      restoredDate.current = true;
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
      if (pricingRes.data) {
        setPricing(pricingRes.data);
        // Past midnight the night can still be running (open till 2 AM): open on it, not on the calendar date
        const day = bookingToday(hoursRes.data ?? [], pricingRes.data.settings.day_ends_at, new Date(), closuresRes.data.map((c) => c.closed_on));
        if (!restoredDate.current && day !== formatManilaDate(new Date())) setSelectedDateRaw(dayStart(day));
      }
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
    const [own, tail] = await fetchBusinessDay(selectedDate);
    setBookings(own.data);
    setTailBookings(tail.data);
    setIsFetchingBookings(false);
  }, [selectedDate]);

  useEffect(() => {
    let ignore = false;
    fetchBusinessDay(selectedDate).then(([own, tail]) => {
      if (!ignore) {
        setBookings(own.data);
        setTailBookings(tail.data);
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
  // Slots from here on are the day's after-midnight hours, stored on the next date
  const tailFrom = useMemo(() => midnightIndex(timeSlots), [timeSlots]);
  const nextDate = useMemo(() => plusDays(selectedDate, 1), [selectedDate]);
  const isTail = useCallback((time: string) => timeSlots.indexOf(time) >= tailFrom, [timeSlots, tailFrom]);
  // Slot indexes that start after a gap in the day: a picked run never spans one. Midnight is not a gap:
  // a run over it is split into two stored bookings at checkout (splitAtMidnight).
  const breaks = useMemo(
    () => new Set(timeSlots.flatMap((t, i) => (i > 0 && i !== tailFrom && slotTimes(timeSlots[i - 1]).end !== slotTimes(t).start ? [i] : []))),
    [timeSlots, tailFrom]
  );

  // A slot's status against its own date's bookings: after-midnight slots against the next date's
  const statusIn = useCallback(
    (own: BookingSlot[], tail: BookingSlot[], courtName: string, timeRange: string) =>
      isTail(timeRange)
        ? checkSlotAvailability(courtName, timeRange, courts, tail, nextDate, user?.id)
        : checkSlotAvailability(courtName, timeRange, courts, own, selectedDate, user?.id),
    [isTail, courts, nextDate, selectedDate, user?.id]
  );
  const getSlotStatus = useCallback(
    (_date: Date, courtName: string, timeRange: string) => statusIn(bookings, tailBookings, courtName, timeRange),
    [statusIn, bookings, tailBookings]
  );

  // No account (or a guest's anonymous session): the checkout asks for their details
  const isGuest = !user || !!user.is_anonymous;

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
    // Each stored part is priced on its own date (a 12 AM hour on the next date is still this day's rate)
    const quotes = pricing
      ? splitAtMidnight(timeSlots, [start, start + duration], selectedDateStr).map((p) =>
          quoteCourtPrice(pricing, p.booking_date, p.start_time, Number(p.end_time.slice(0, 2)) - Number(p.start_time.slice(0, 2)))
        )
      : [];
    const price = quotes.reduce((sum, q) => sum + q.total, 0);
    const hasPeak = quotes.some((q) => q.hasPeak);
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
      const slotBooking = getSlotBooking(courtName, time, courts, isTail(time) ? tailBookings : bookings);
      if (slotBooking?.id) {
        setPendingBookingToResume({
          bookingId: slotBooking.id,
          courtName,
          time,
          date: isTail(time) ? nextDate : selectedDate,
          holdExpiresAt: slotBooking.hold_expires_at,
        });
        return;
      }
    }

    if (status !== "available") return;

    // A court can hold several separate times; each is its own basket line
    const onCourt = basket.filter((l) => l.court === courtName);
    const clickedIndex = timeSlots.indexOf(time);

    // Tapping inside a picked range removes just that hour, splitting the range
    const inside = onCourt.find((l) => {
      const [s, e] = lineSpan(l);
      return clickedIndex >= s && clickedIndex < e;
    });
    if (inside) {
      const [s, e] = lineSpan(inside);
      // A leftover piece shorter than the minimum booking can't be booked on its own, so it goes too
      const pieces = ([[s, clickedIndex], [clickedIndex + 1, e]] as const).filter(([a, b]) => b - a >= Math.max(minHours, 1));
      setCourtSpans(courtName, [...spansOn(courtName).filter(([a]) => a !== s), ...pieces]);
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

  // Everyone checks out in the same dialog; a guest fills in their details there (an account is optional)
  const startCheckout = (lines: Slot[] = basket) => {
    setBasket(lines);
    setIsDialogOpen(true);
  };

  // "Sign in" or "create one" from the dialog: the courts are kept for after signing in
  const signInToPay = (page: "/login" | "/register") => {
    try {
      sessionStorage.setItem(PENDING_BASKET_KEY, JSON.stringify({ date: selectedDate.toISOString(), lines: basket }));
    } catch {
      // Storage blocked (private mode): the player just picks again after signing in
    }
    router.push(page);
  };

  // The next day with bookable hours (within a month), for the closed-day shortcut
  const nextOpenDate = useMemo(() => {
    if (timeSlots.length > 0) return null;
    const closedDates = closures.map((c) => c.closed_on);
    for (let i = 1; i <= 31; i++) {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + i);
      if (generateTimeSlots(d, operatingHours, closedDates).length > 0) return d;
    }
    return null;
  }, [timeSlots, selectedDate, operatingHours, closures]);

  const dayNote = (d: Date) => {
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const own = operatingHours.find((h) => h.day_of_week === weekday && h.is_open);
    if (!own || generateTimeSlots(d, operatingHours, closures.map((c) => c.closed_on)).length === 0) {
      return { closed: true, text: "Closed" };
    }
    return { closed: false, text: `till ${formatTime12h(own.close_time).replace(":00 ", " ")}` };
  };

  const openHours = courtNames.reduce(
    (n, court) => n + timeSlots.filter((time) => getSlotStatus(selectedDate, court, time) === "available").length,
    0
  );
  // The day strip starts on the night still running: at 12:30 AM a day open till 2 AM is still "Today"
  const firstDay = dayStart(bookingToday(operatingHours, pricing?.settings.day_ends_at, new Date(), closures.map((c) => c.closed_on)));
  const isToday = selectedDate.toDateString() === firstDay.toDateString();
  // The strip scrolls through four weeks from today, and stretches to a week past any later date picked
  const selectedAhead = Math.round((dayStart(selectedDateStr).getTime() - firstDay.getTime()) / 86_400_000);
  const stripDays = Math.max(28, selectedAhead + 7);
  const stripRef = useRef<HTMLDivElement>(null);
  // Keep the chosen day centred in the strip; scrolls the strip only, never the page
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (strip && chip) strip.scrollTo({ left: chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2, behavior: "smooth" });
  }, [selectedDateStr, loading]);
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

  // Back from the QR page restores this page from the browser cache with the Pay button still loading
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setIsCheckoutLoading(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const confirmBooking = async (details: CheckoutDetails) => {
    if (basket.length === 0) return;

    setIsCheckoutLoading(true);
    setCheckoutError(null);

    try {
      // A run over midnight is stored as two bookings, one on each date
      const lines = basket.flatMap((line) => {
        const court = courts.find((c) => c.name === line.court);
        if (!court) throw new Error("Court not found");
        return splitAtMidnight(timeSlots, lineSpan(line), selectedDateStr).map((part) => ({ court_id: court.id, ...part }));
      });

      // A guest pays on an anonymous session, so the hold, the QR page and My Bookings on this device are theirs
      if (!user) {
        const { data, error } = await createClient().auth.signInAnonymously();
        if (error || !data.user) throw new Error("Guest checkout isn't available right now. Please sign in or create an account to book.");
      }

      const url = await createCheckoutSession({
        bookingDate: selectedDateStr,
        lines,
        playerCount: details.playerCount,
        discountCode: details.discountCode,
        guest: isGuest ? details.guest : null,
      });

      window.location.assign(url);
    } catch (err: unknown) {
      setCheckoutError((err as Error).message || "An unexpected error occurred");
      setIsCheckoutLoading(false);
      // Drop courts someone else took meanwhile, or every retry fails with the same 409
      const [fresh, freshTail] = await fetchBusinessDay(selectedDate);
      setBookings(fresh.data);
      setTailBookings(freshTail.data);
      const { kept, dropped } = splitTakenLines(basket, (line) => {
        const start = timeSlots.indexOf(line.startSlot || line.time);
        return Array.from({ length: line.duration || 1 }, (_, i) => timeSlots[start + i]).every(
          (slot) => slot && statusIn(fresh.data, freshTail.data, line.court, slot) === "available"
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
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            <span className="size-2 rounded-full bg-primary live-dot" aria-hidden />
            {loading
              ? "Live availability"
              : `${isToday ? "Live · " : ""}${selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${closesAt ? ` · open till ${closesAt}` : " · closed"}`}
          </p>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold leading-tight text-balance">
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
          </h2>
          <p className="mt-2 text-muted-foreground max-w-md">
            Pick a date, choose your court and time slot, add more hours if you like, then check out.
          </p>
        </div>
        {!loading && timeSlots.length > 0 && goingFast && (
          <span className="text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-full">
            Going fast
          </span>
        )}
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
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              if (d >= firstDay) setSelectedDate(d);
            }}
            className="size-11 shrink-0 rounded-xl border bg-card flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div ref={stripRef} className="relative flex-1 overflow-x-auto scrollbar-none">
            <div className="flex gap-2 pb-1">
              {Array.from({ length: stripDays }).map((_, i) => {
                const d = plusDays(firstDay, i);
                const ahead = Math.round((d.getTime() - firstDay.getTime()) / 86_400_000);
                const isSelected = d.toDateString() === selectedDate.toDateString();
                const sub = dayNote(d);
                return (
                  <button
                    key={ahead}
                    onClick={() => setSelectedDate(d)}
                    aria-pressed={isSelected}
                    className={`shrink-0 min-w-24 flex flex-col items-start px-3.5 py-2 rounded-xl text-left transition-colors border ${
                      isSelected ? "bg-primary text-primary-foreground border-primary" : sub.closed ? "bg-muted text-muted-foreground" : "bg-card hover:border-primary/40"
                    }`}
                  >
                    <span className="text-[11px] font-semibold opacity-85">
                      {ahead === 0 ? "Today" : ahead === 1 ? "Tmrw" : d.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className="text-base font-bold">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span className={`text-[11px] font-semibold ${isSelected ? "" : sub.closed ? "" : "text-primary"}`}>{sub.text}</span>
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
            className="size-11 shrink-0 rounded-xl border bg-card flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowMobileCalendar((prev) => !prev)}
            aria-expanded={showMobileCalendar}
            className="hidden sm:inline-flex shrink-0 min-h-11 items-center gap-2 rounded-xl border bg-card px-3.5 text-sm font-semibold hover:bg-muted"
          >
            <Calendar className="size-4" />
            Pick another date
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowMobileCalendar((prev) => !prev)}
          aria-expanded={showMobileCalendar}
          className="sm:hidden self-start text-primary font-semibold text-sm flex items-center gap-1.5 py-1 px-1"
        >
          <Calendar className="size-3.5" />
          {showMobileCalendar ? "Hide calendar" : "Pick another date"}
        </button>
        {showMobileCalendar && (
          <div className="max-w-md animate-in fade-in slide-in-from-top-2 duration-200">
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
        <GridLegend />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="min-w-0">
          {timeSlots.length > 0 ? (
            <div className={basket.length > 0 ? BASKET_SHEET_PADDING : ""}>
              <CourtAvailabilityGrid
                selectedDate={selectedDate}
                courts={courtNames}
                timeSlots={timeSlots}
                onSlotClick={handleSlotClick}
                getSlotStatus={getSlotStatus}
                selectedSlots={basket}
                isFetching={isFetchingBookings}
                priceOf={(time) => priceFor(isTail(time) ? nextDate : selectedDate, time, 1).total}
                peakOf={(time) => priceFor(isTail(time) ? nextDate : selectedDate, time, 1).hasPeak}
                headingOf={(time) => (isTail(time) ? "After midnight" : dayName)}
              />

            </div>
          ) : (
            <VenueClosed
              date={selectedDate}
              closedDate={!!closure}
              reason={closure?.reason}
              nextOpen={nextOpenDate}
              onPick={setSelectedDate}
              onPickAnother={() => setShowMobileCalendar(true)}
            />
          )}
        </div>
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
      </div>
      )}

      <BookingModal
        isOpen={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          // Closing while the QR page loads must not leave the Pay button spinning when the modal is reopened
          if (!open) {
            setCheckoutError(null);
            setIsCheckoutLoading(false);
          }
        }}
        lines={basket}
        isLoading={isCheckoutLoading}
        error={checkoutError}
        onConfirm={confirmBooking}
        isGuest={isGuest}
        maxPlayers={maxPlayers(pricing?.settings.max_players_per_court ?? 8, new Set(basket.map((l) => l.court)).size)}
        onSignIn={signInToPay}
        checkoutAmounts={
          pricing
            ? basket.flatMap((line) =>
                splitAtMidnight(timeSlots, lineSpan(line), selectedDateStr).map(
                  (p) => quoteCourtPrice(pricing, p.booking_date, p.start_time, Number(p.end_time.slice(0, 2)) - Number(p.start_time.slice(0, 2))).total
                )
              )
            : undefined
        }
      />

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
                <QrCode className="size-3.5" />
              )}
              {isResumingGridBooking ? "Opening QR Ph..." : "Continue to Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
