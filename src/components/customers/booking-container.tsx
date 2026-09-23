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

// Helper to format time (e.g. "13:00" -> "01:00 PM")
const formatTime12h = (timeStr?: string) => {
  if (!timeStr) return "";
  const [hoursStr, minutesStr] = timeStr.split(":");
  let hours = parseInt(hoursStr, 10);
  if (isNaN(hours)) return "";
  const minutes = minutesStr || "00";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const formattedHours = hours < 10 ? `0${hours}` : hours.toString();
  return `${formattedHours}:${minutes} ${ampm}`;
};

// Convert "08:00 AM" back to "08:00" (24h) for comparison with DB times
const to24h = (time12h: string): string => {
  const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return time12h;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return `${hours < 10 ? "0" : ""}${hours}:${minutes}`;
};

const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Format date as YYYY-MM-DD for Supabase query
const formatDateForDB = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export function BookingContainer() {
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
        setCourts(courtsRes.data.filter((c) => c.status !== "maintenance"));
      }
      setLoading(false);
    };
    loadInitialData();
  }, []);

  // Load bookings when selected date changes
  useEffect(() => {
    const loadBookings = async () => {
      const dateStr = formatDateForDB(selectedDate);
      const { data } = await fetchBookingsForDate(dateStr);
      setBookings(data);
    };
    loadBookings();
  }, [selectedDate]);

  const courtNames = useMemo(() => courts.map((c) => c.name), [courts]);

  const timeSlots = useMemo(() => {
    if (!operatingHours.length) return [];

    const dayName = FULL_DAYS[selectedDate.getDay()];
    const todaySchedule = operatingHours.find((h) => h.day === dayName);

    if (!todaySchedule || !todaySchedule.isOpen || !todaySchedule.openTime || !todaySchedule.closeTime) {
      return [];
    }

    const openHour = parseInt(todaySchedule.openTime.split(":")[0], 10);
    const closeHour = parseInt(todaySchedule.closeTime.split(":")[0], 10);

    const slots = [];
    for (let i = openHour; i < closeHour; i++) {
      const start = formatTime12h(`${i < 10 ? "0" : ""}${i}:00`);
      const end = formatTime12h(`${i + 1 < 10 ? "0" : ""}${i + 1}:00`);
      slots.push(`${start} - ${end}`);
    }
    return slots;
  }, [operatingHours, selectedDate]);

  // Check if a slot is booked by comparing against real bookings
  const checkAvailability = useCallback(
    (_date: Date, courtName: string, timeRange: string) => {
      const court = courts.find((c) => c.name === courtName);
      if (!court) return false;

      const [startStr, endStr] = timeRange.split(" - ");
      const slotStart = to24h(startStr.trim());
      const slotEnd = to24h(endStr.trim());

      const isBooked = bookings.some((b) => {
        if (b.court_id !== court.id) return false;
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time.slice(0, 5);
        return bStart < slotEnd && bEnd > slotStart;
      });

      return !isBooked;
    },
    [courts, bookings]
  );

  const handleSlotClick = (courtName: string, time: string) => {
    if (!checkAvailability(selectedDate, courtName, time)) return;

    // If not logged in, show login prompt
    if (!user) {
      setShowLoginPrompt(true);
      return;
    }

    setSelectedSlot({
      date: selectedDate,
      court: courtName,
      time,
      price: courtName.includes("Premium") ? 2000 : 1500,
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

      const dateStr = formatDateForDB(selectedSlot.date);
      const [startStr, endStr] = selectedSlot.time.split(" - ");
      const startTime24 = to24h(startStr.trim());
      const endTime24 = to24h(endStr.trim());

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          court_id: court.id,
          court_name: court.name,
          booking_date: dateStr,
          start_time: startTime24,
          end_time: endTime24,
          amount: selectedSlot.price,
        }),
      });

      const contentType = res.headers.get("content-type");
      let data;
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        throw new Error("Server returned an invalid response.");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create checkout session");
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
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
          checkAvailability={checkAvailability}
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
