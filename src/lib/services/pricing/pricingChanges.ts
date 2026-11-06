import type { Pricing } from "./quoteCourtPrice.ts";

const peso = (n: number) => `₱${Number(n).toLocaleString("en-PH")}`;
// A rate more than doubled or cut by more than half is usually a typo (₱2,500 for ₱250)
const bigJump = (from: number, to: number) => from > 0 && (to > from * 2 || to < from / 2);
const windowKey = (p: Pricing["peakRates"][number]) =>
    `${p.label}|${[...p.days].sort().join(",")}|${p.start_time.slice(0, 5)}|${p.end_time.slice(0, 5)}|${Number(p.hourly_rate)}`;

/** What saving would change, in staff wording; empty when nothing changed. */
export function pricingChanges(before: Pricing, after: Pricing): string[] {
    const lines: string[] = [];
    const b = before.settings, a = after.settings;
    if (Number(b.base_hourly_rate) !== Number(a.base_hourly_rate)) {
        const warn = bigJump(Number(b.base_hourly_rate), Number(a.base_hourly_rate))
            ? Number(a.base_hourly_rate) > Number(b.base_hourly_rate) ? " (more than double)" : " (less than half)"
            : "";
        lines.push(`Base rate: ${peso(b.base_hourly_rate)} → ${peso(a.base_hourly_rate)} per hour${warn}`);
    }
    if (b.min_hours !== a.min_hours) lines.push(`Minimum booking: ${b.min_hours} → ${a.min_hours} hours`);
    const beforeKeys = new Set(before.peakRates.map(windowKey));
    const afterKeys = new Set(after.peakRates.map(windowKey));
    const added = after.peakRates.filter((p) => !beforeKeys.has(windowKey(p)));
    const removed = before.peakRates.filter((p) => !afterKeys.has(windowKey(p)));
    for (const p of removed) lines.push(`Peak window removed: ${p.label || "Unnamed"} (${peso(p.hourly_rate)}/hr)`);
    for (const p of added) {
        const warn = bigJump(Number(a.base_hourly_rate), Number(p.hourly_rate)) ? " (far from the base rate)" : "";
        lines.push(`Peak window: ${p.label || "Unnamed"} at ${peso(p.hourly_rate)}/hr${warn}`);
    }
    return lines;
}
