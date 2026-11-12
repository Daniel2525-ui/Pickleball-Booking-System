import { WEEKDAYS, type PeakRate } from "./quoteCourtPrice.ts";

export interface PricingInput {
    base_hourly_rate: number;
    min_hours: number;
    max_hours: number;
    peak_rates: Omit<PeakRate, "id">[];
}

const MAX_RATE = 100_000;
const MAX_PEAK_WINDOWS = 20;
const WHOLE_HOUR = /^([01]\d|2[0-3]):00(:00)?$/;
const isRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_RATE;

/** Validates the admin pricing form before it reaches save_pricing_settings (which re-checks via constraints). */
export const validatePricingInput = (body: unknown): { ok: true; value: PricingInput } | { ok: false; error: string } => {
    const b = body as Record<string, unknown> | null;
    if (!b || typeof b !== "object") return { ok: false, error: "Pricing data is required." };

    if (!isRate(b.base_hourly_rate)) return { ok: false, error: `Base hourly rate must be between 1 and ${MAX_RATE.toLocaleString()}.` };
    const min = b.min_hours, max = b.max_hours;
    if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 1 || (max as number) > 12 || (min as number) > (max as number)) {
        return { ok: false, error: "Minimum booking must be whole hours between 1 and 12." };
    }

    if (!Array.isArray(b.peak_rates) || b.peak_rates.length > MAX_PEAK_WINDOWS) {
        return { ok: false, error: `Add at most ${MAX_PEAK_WINDOWS} peak windows.` };
    }
    const peaks: PricingInput["peak_rates"] = [];
    for (const [i, raw] of b.peak_rates.entries()) {
        const p = raw as Record<string, unknown>;
        const n = i + 1;
        const label = typeof p?.label === "string" ? p.label.trim() : "";
        if (label.length > 60) return { ok: false, error: `Peak window ${n}: name is too long.` };
        const days = Array.isArray(p?.days) ? [...new Set(p.days)] : [];
        if (days.length === 0 || !days.every((d) => WEEKDAYS.includes(d as string))) {
            return { ok: false, error: `Peak window ${n}: pick at least one day.` };
        }
        if (typeof p.start_time !== "string" || typeof p.end_time !== "string" || !WHOLE_HOUR.test(p.start_time) || !(WHOLE_HOUR.test(p.end_time) || /^24:00(:00)?$/.test(p.end_time))) { // a window can run to midnight
            return { ok: false, error: `Peak window ${n}: start and end must be on the hour.` };
        }
        if (p.end_time.slice(0, 5) <= p.start_time.slice(0, 5)) return { ok: false, error: `Peak window ${n}: end must be after start.` };
        if (!isRate(p.hourly_rate)) return { ok: false, error: `Peak window ${n}: rate must be between 1 and ${MAX_RATE.toLocaleString()}.` };
        peaks.push({ label, days: days as string[], start_time: p.start_time.slice(0, 5), end_time: p.end_time.slice(0, 5), hourly_rate: p.hourly_rate });
    }

    return { ok: true, value: { base_hourly_rate: b.base_hourly_rate, min_hours: min as number, max_hours: max as number, peak_rates: peaks } };
};
