/**
 * Court pricing rules, mirrored from public.quote_court_price (configurable_pricing migration).
 * The database is authoritative for what is charged; this copy prices slots for display.
 */

import { businessDate } from "../../utils/bookingTime.ts";

export interface BookingSettings {
    base_hourly_rate: number;
    min_hours: number;
    max_hours: number;
    /** Business-day cutoff ("HH:MM[:SS]"): earlier hours are priced as the previous day's late night */
    day_ends_at?: string;
}

export interface PeakRate {
    id?: string;
    label: string;
    days: string[];
    start_time: string; // "HH:MM" or "HH:MM:SS"
    end_time: string;
    hourly_rate: number;
}

export interface Pricing {
    settings: BookingSettings;
    peakRates: PeakRate[];
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const minutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + (m || 0);
};

// Weekday of a YYYY-MM-DD venue date (the date itself, no time zone shift)
const weekdayOf = (bookingDate: string) =>
    new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${bookingDate}T00:00:00Z`));

/** Rate for the hour starting at `hourStart`: highest peak window containing it on its business day's weekday, else base. */
export const hourlyRate = (pricing: Pricing, bookingDate: string, hourStart: string) => {
    const day = weekdayOf(businessDate(bookingDate, hourStart, pricing.settings.day_ends_at));
    const at = minutes(hourStart);
    const peaks = pricing.peakRates
        .filter((p) => p.days.includes(day) && minutes(p.start_time) <= at && at < minutes(p.end_time))
        .map((p) => Number(p.hourly_rate));
    return peaks.length ? Math.max(...peaks) : Number(pricing.settings.base_hourly_rate);
};

/** Total for a booking from startTime ("HH:MM") for `hours` whole hours, plus whether any hour is at a peak rate. */
export const quoteCourtPrice = (pricing: Pricing, bookingDate: string, startTime: string, hours: number) => {
    const base = Number(pricing.settings.base_hourly_rate);
    let total = 0;
    let hasPeak = false;
    for (let i = 0; i < hours; i++) {
        const start = minutes(startTime) + i * 60;
        const hourStart = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
        const rate = hourlyRate(pricing, bookingDate, hourStart);
        if (rate !== base) hasPeak = true;
        total += rate;
    }
    return { total, hasPeak };
};

/** Lowest hourly rate a customer can pay, for "From ₱X/hr" copy. */
export const lowestHourlyRate = (pricing: Pricing) =>
    Math.min(Number(pricing.settings.base_hourly_rate), ...pricing.peakRates.map((p) => Number(p.hourly_rate)));
