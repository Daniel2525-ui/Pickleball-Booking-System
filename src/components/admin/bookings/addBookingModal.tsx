"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus, AlertCircle, Search, UserCheck, UserPlus, Banknote, Smartphone, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { searchCustomers } from "@/lib/services/customers/searchCustomers.service";
import { createWalkInCustomer } from "@/lib/services/customers/createWalkInCustomer.service";
import { createWalkInBooking } from "@/lib/services/bookings/createWalkInBooking.service";
import { supabase as browserSupabase } from "@/lib/supabase";
import { fetchPricing } from "@/lib/services/pricing/fetchPricing.service";
import { quoteCourtPrice, type Pricing } from "@/lib/services/pricing/quoteCourtPrice";
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { formatTime12h } from "@/lib/utils/formatTime";
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service";
import { fetchUpcomingClosures } from "@/lib/services/schedule/venueClosures.service";
import { fetchBookingsForDate, type BookingSlot } from "@/lib/services/bookings/fetchBookingsForDate.service";
import { walkInStarts, walkInEnds, type WalkInSlotInput } from "@/lib/services/bookings/walkInSlots";
import { useLiveRefresh } from "@/hooks/use-live-refresh";

/** "HH:MM" now in venue time, to compare with the time inputs. */
const manilaClock = () =>
  new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false });
import { Court } from "@/lib/services/courts/courtsTypes";
import { UnifiedCustomerResult } from "@/lib/services/customers/customersTypes";

interface AddBookingModalProps {
  onBookingAdded?: () => void;
}

export const AddBookingModal = ({ onBookingAdded }: AddBookingModalProps = {}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [courts, setCourts] = useState<Court[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pricingFailed, setPricingFailed] = useState(false);

  // Player mode: "existing" or "new"
  const [playerMode, setPlayerMode] = useState<"existing" | "new">("existing");

  // Existing player search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UnifiedCustomerResult[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<UnifiedCustomerResult | null>(null);
  const [searching, setSearching] = useState(false);

  // New walk-in player fields
  const [newFullName, setNewFullName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<UnifiedCustomerResult | null>(null);

  // Reservation details
  const [courtId, setCourtId] = useState("");
  const [date, setDate] = useState("");
  const [pickedStart, setStartTime] = useState("");
  const [pickedEnd, setEndTime] = useState("");
  const [hours, setHours] = useState<WalkInSlotInput["hours"]>([]);
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [dayBookings, setDayBookings] = useState<BookingSlot[]>([]);
  const [amount, setAmount] = useState("200");

  // Payment details
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "gcash" | "unpaid">("cash");
  const [paymentReference, setPaymentReference] = useState("");

  const resetForm = () => {
    setPlayerMode("existing");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedPlayer(null);
    setNewFullName("");
    setNewPhone("");
    setNewEmail("");
    setDuplicateWarning(null);
    setError(null);
    setPaymentMethod("cash");
    setPaymentReference("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      resetForm();
    }
  };

  const activeDuplicateWarning =
    open && playerMode === "new" && newFullName.trim() ? duplicateWarning : null;

  // Load courts when modal opens
  useEffect(() => {
    if (open) {
      fetchCourtsData().then((res) => setCourts(res.data || []));
      fetchPricing(browserSupabase).then((res) => {
        setPricing(res.data);
        setPricingFailed(!res.data);
      });
      fetchOperatingHours().then((res) => setHours(res.data || []));
      fetchUpcomingClosures().then((res) => setClosedDates(res.data.map((c) => c.closed_on)));
    }
  }, [open]);

  useEffect(() => {
    if (!open || !date) return;
    let ignore = false;
    fetchBookingsForDate(date).then(({ data }) => {
      if (!ignore) setDayBookings(data);
    });
    return () => {
      ignore = true;
    };
  }, [open, date]);

  // A no-show, cancellation or online booking elsewhere frees or takes hours while this form is open
  useLiveRefresh(() => {
    if (open && date) fetchBookingsForDate(date).then(({ data }) => setDayBookings(data));
  });

  // Only real slots can be picked; a pick that stops being valid (court or date changed) reads as empty
  const slotInput: WalkInSlotInput = {
    date,
    courtId,
    courtStatus: courts.find((c) => c.id === courtId)?.status ?? "",
    hours,
    closedDates,
    bookings: dayBookings,
    minHours: pricing?.settings.min_hours as number,
    maxHours: pricing?.settings.max_hours as number,
  };
  const starts = pricing && courtId && date ? walkInStarts(slotInput) : [];
  const startTime = starts.some((s) => s.time === pickedStart && !s.taken) ? pickedStart : "";
  const ends = startTime ? walkInEnds(slotInput, startTime) : [];
  const endTime = ends.includes(pickedEnd) ? pickedEnd : "";
  // Tell staff why a pick vanished instead of letting save fail with "complete all details"
  const pickLost = Boolean((pickedStart && !startTime) || (pickedEnd && startTime && !endTime));
  // Past hours today stay pickable (late entries), but are labelled so they aren't booked by mistake
  const clock = date === formatManilaDate() ? manilaClock() : "";
  const pastLabel = (time: string) => {
    if (!clock) return "";
    const nextHour = `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}:00`;
    return nextHour <= clock ? " · Ended" : time <= clock ? " · Started" : "";
  };

  // Debounced search for existing players
  useEffect(() => {
    if (!open || playerMode !== "existing") return;

    const timer = setTimeout(async () => {
      setSearching(true);
      const { data } = await searchCustomers(searchQuery);
      setSearchResults(data || []);
      setSearching(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, open, playerMode]);

  // Live duplicate check when typing a new walk-in name
  useEffect(() => {
    if (!open || playerMode !== "new" || !newFullName.trim()) {
      return;
    }

    const timer = setTimeout(async () => {
      const { data } = await searchCustomers(newFullName.trim());
      const exactMatch = (data || []).find(
        (c) => c.full_name.toLowerCase() === newFullName.trim().toLowerCase()
      );
      setDuplicateWarning(exactMatch || null);
    }, 400);

    return () => clearTimeout(timer);
  }, [newFullName, open, playerMode]);

  // Court fee follows the configured rates (peak windows depend on the date); the database checks it again
  const updateFee = (nextDate: string, nextStart: string, nextEnd: string) => {
    if (!pricing || !nextDate || !nextStart || !nextEnd) return;
    const duration = parseInt(nextEnd.split(":")[0], 10) - parseInt(nextStart.split(":")[0], 10);
    if (duration >= pricing.settings.min_hours && duration <= pricing.settings.max_hours) {
      setAmount(String(quoteCourtPrice(pricing, nextDate, nextStart, duration).total));
    }
  };
  const handleStartTimeChange = (newStartTime: string) => {
    const keepEnd = walkInEnds(slotInput, newStartTime).includes(endTime) ? endTime : "";
    setStartTime(newStartTime);
    setEndTime(keepEnd);
    updateFee(date, newStartTime, keepEnd);
  };
  const handleEndTimeChange = (newEndTime: string) => {
    setEndTime(newEndTime);
    updateFee(date, startTime, newEndTime);
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!courtId || !date || !startTime || !endTime || !amount) {
      setError("Please complete all reservation schedule and fee details.");
      return;
    }

    let customerId: string | null = null;
    let userId: string | null = null;
    let customerName = "";

    if (playerMode === "existing") {
      if (!selectedPlayer) {
        setError("Please search and select a player, or create a new walk-in player.");
        return;
      }
      customerName = selectedPlayer.full_name;
      if (selectedPlayer.type === "registered") {
        userId = selectedPlayer.id;
      } else {
        customerId = selectedPlayer.id;
      }
    } else {
      if (!newFullName.trim()) {
        setError("Walk-in player's full name is required.");
        return;
      }
      customerName = newFullName.trim();

      setLoading(true);
      const { data: createdCust, error: custErr } = await createWalkInCustomer({
        fullName: customerName,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
      });

      if (custErr || !createdCust) {
        setLoading(false);
        setError(custErr?.message || "Failed to create customer record.");
        return;
      }
      customerId = createdCust.id;
      // If the booking below is rejected, a retry reuses this record instead of creating another
      setSelectedPlayer({ ...createdCust, type: "walk_in" });
      setPlayerMode("existing");
    }

    setLoading(true);

    const { bookingId, error: bookingErr } = await createWalkInBooking({
      customerId,
      userId,
      customerName,
      courtId,
      bookingDate: date,
      startTime,
      endTime,
      amount: Number(amount),
      paymentMethod,
      paymentReference: paymentMethod === "gcash" ? paymentReference : undefined,
    });

    setLoading(false);

    if (bookingErr || !bookingId) {
      setError(bookingErr?.message || "Failed to create reservation.");
    } else {
      toast.success("Reservation recorded successfully!");
      setOpen(false);
      onBookingAdded?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button className="w-full sm:w-auto gap-2 font-bold text-xs sm:text-sm shadow-xs hover:shadow">
            <Plus className="h-4 w-4" />
            New Reservation
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Record Manual Reservation</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Book a walk-in player or phone reservation and record counter payment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {/* Player Mode Tabs */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-foreground">Customer / Player</Label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setPlayerMode("existing")}
                className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  playerMode === "existing"
                    ? "bg-card text-foreground shadow-2xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Search className="size-3.5" />
                Existing Player
              </button>
              <button
                type="button"
                onClick={() => setPlayerMode("new")}
                className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  playerMode === "new"
                    ? "bg-card text-foreground shadow-2xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UserPlus className="size-3.5" />
                New Walk-In
              </button>
            </div>

            {/* Existing Player Search Panel */}
            {playerMode === "existing" ? (
              <div className="flex flex-col gap-2 mt-1">
                {selectedPlayer ? (
                  <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                        <UserCheck className="size-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm text-foreground">
                          {selectedPlayer.full_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {selectedPlayer.phone || selectedPlayer.email || (selectedPlayer.type === "registered" ? "Online Member" : "Walk-in Guest")}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPlayer(null)}
                      className="text-xs font-semibold text-muted-foreground hover:text-foreground h-8"
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                      <Input
                        type="text"
                        placeholder="Search player by name or phone..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-9 text-xs sm:text-sm"
                      />
                    </div>

                    <div className="max-h-[140px] overflow-y-auto border border-border rounded-lg divide-y divide-border/60 bg-card">
                      {searching ? (
                        <div className="p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                          <Loader2 className="size-3.5 animate-spin" />
                          Searching players...
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="p-3 text-center text-xs text-muted-foreground">
                          {searchQuery ? "No matching players found. Switch to 'New Walk-In' to register." : "Type a name or phone to search..."}
                        </div>
                      ) : (
                        searchResults.map((player) => (
                          <button
                            key={player.id}
                            type="button"
                            onClick={() => setSelectedPlayer(player)}
                            className="w-full p-2.5 text-left text-xs hover:bg-muted/50 flex items-center justify-between transition-colors"
                          >
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground text-xs">
                                {player.full_name}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {player.phone || player.email || "No contact info"}
                              </span>
                            </div>
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {player.type === "registered" ? "Member" : "Walk-in"}
                            </Badge>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* New Walk-In Registration Panel */
              <div className="flex flex-col gap-2.5 mt-1 p-3 bg-muted/30 border border-border rounded-lg">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="walkin-name" className="text-xs font-semibold text-foreground">
                    Full Name <span className="text-destructive">*</span>
                  </Label>
                  <Input id="walkin-name"
                    type="text"
                    placeholder="e.g. Juan Dela Cruz"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    className="h-8 text-xs sm:text-sm"
                    required
                  />
                </div>

                {/* Duplicate Warning Alert */}
                {activeDuplicateWarning && (
                  <div className="p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                      <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-[11px]">Possible duplicate player found!</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          &quot;{activeDuplicateWarning.full_name}&quot; is already registered ({activeDuplicateWarning.phone || "No phone"}).
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedPlayer(activeDuplicateWarning);
                        setPlayerMode("existing");
                        setDuplicateWarning(null);
                      }}
                      className="text-[11px] h-7 px-2 border-amber-500/30 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
                    >
                      Use Existing
                    </Button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="walkin-phone" className="text-[11px] font-medium text-muted-foreground">Phone (Optional)</Label>
                    <Input id="walkin-phone"
                      type="tel"
                      placeholder="e.g. 09171234567"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="walkin-email" className="text-[11px] font-medium text-muted-foreground">Email (Optional)</Label>
                    <Input id="walkin-email"
                      type="email"
                      placeholder="e.g. juan@example.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Assigned Court */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkin-court" className="text-xs font-semibold text-foreground">Assigned Court</Label>
            <Select value={courtId} onValueChange={(value) => setCourtId(value as string)}>
              <SelectTrigger id="walkin-court" className="h-9 text-xs sm:text-sm">
                <SelectValue placeholder="Choose a court">
                  {(value) => {
                    const court = courts.find((court) => court.id === value);
                    return court ? court.name : value;
                  }}
                </SelectValue>
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
            <Label htmlFor="walkin-date" className="text-xs font-semibold text-foreground">Reservation Date</Label>
            <Input id="walkin-date"
              type="date"
              min={formatManilaDate()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                updateFee(e.target.value, startTime, endTime);
              }}
              className="h-9 text-xs sm:text-sm"
            />
          </div>

          {/* Times Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="walkin-start" className="text-xs font-semibold text-foreground">Start Time</Label>
              <Select value={startTime} onValueChange={(value) => handleStartTimeChange(value as string)} disabled={!courtId || !date || !starts.length}>
                <SelectTrigger id="walkin-start" className="h-9 text-xs sm:text-sm">
                  <SelectValue placeholder="Start">{(value) => (value ? formatTime12h(value as string) : "Start")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {starts.map((s) => (
                    <SelectItem key={s.time} value={s.time} disabled={s.taken} className="text-xs sm:text-sm">
                      {formatTime12h(s.time)}{s.taken ? " · Booked" : pastLabel(s.time)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="walkin-end" className="text-xs font-semibold text-foreground">End Time</Label>
              <Select value={endTime} onValueChange={(value) => handleEndTimeChange(value as string)} disabled={!startTime}>
                <SelectTrigger id="walkin-end" className="h-9 text-xs sm:text-sm">
                  <SelectValue placeholder="End">{(value) => (value ? formatTime12h(value as string) : "End")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ends.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs sm:text-sm">
                      {formatTime12h(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {pricingFailed && (
            <p className="text-[11px] text-muted-foreground">Couldn&apos;t load the price list. Close and reopen this form to try again.</p>
          )}
          {courtId && date && pricing && !starts.some((s) => !s.taken) && (
            <p className="text-[11px] text-muted-foreground">No open slots for this court on this date.</p>
          )}
          {pickLost && (
            <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200">
              The time you picked is no longer available. Pick another.
            </p>
          )}

          {/* A slot that ended earlier today is saved as already played */}
          {date === formatManilaDate() && endTime.length >= 5 && endTime !== "00:00" && endTime <= manilaClock() && (
            <p role="status" className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-900 dark:text-blue-200">
              This game already ended. It will be saved as played, not as an upcoming booking.
            </p>
          )}

          {/* Court Fee: set by the price list, so shown as text */}
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-foreground">Court Fee</span>
              <span className="text-[11px] text-muted-foreground">From the price list for this date and time.</span>
            </div>
            <span className="text-lg font-black text-foreground">
              {startTime && endTime ? `₱${Number(amount).toLocaleString()}` : "—"}
            </span>
          </div>

          {/* Payment Method Selector */}
          <div className="flex flex-col gap-2 pt-1 border-t border-border">
            <Label className="text-xs font-semibold text-foreground">Payment Collection</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                  paymentMethod === "cash"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-bold"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Banknote className="size-4" />
                <span>Cash (Paid)</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("gcash")}
                className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                  paymentMethod === "gcash"
                    ? "border-blue-500 bg-blue-500/10 text-blue-800 dark:text-blue-300 font-bold"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Smartphone className="size-4" />
                <span>GCash (Paid)</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("unpaid")}
                className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                  paymentMethod === "unpaid"
                    ? "border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-300 font-bold"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Clock className="size-4" />
                <span>Pay Later</span>
              </button>
            </div>

            {/* Optional GCash Reference Field */}
            {paymentMethod === "gcash" && (
              <div className="flex flex-col gap-1 mt-1">
                <Label className="text-[11px] font-medium text-muted-foreground">
                  GCash Reference No. (Optional)
                </Label>
                <Input
                  type="text"
                  placeholder="e.g. 1029384756"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            )}
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
