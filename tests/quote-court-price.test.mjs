import test from "node:test";
import assert from "node:assert/strict";
import { quoteCourtPrice, hourlyRate, lowestHourlyRate } from "../src/lib/services/pricing/quoteCourtPrice.ts";

const pricing = {
    settings: { base_hourly_rate: 200, min_hours: 1, max_hours: 4 },
    peakRates: [
        { label: "Weeknight", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], start_time: "17:00:00", end_time: "22:00:00", hourly_rate: 300 },
        { label: "Weekend", days: ["Saturday", "Sunday"], start_time: "08:00", end_time: "23:00", hourly_rate: 280 },
        { label: "Friday prime", days: ["Friday"], start_time: "19:00", end_time: "21:00", hourly_rate: 350 },
    ],
};
// 2026-11-02 is a Monday, 2026-11-06 a Friday, 2026-11-07 a Saturday
test("each hour is priced on its own: base before the window, peak inside it", () => {
    assert.deepEqual(quoteCourtPrice(pricing, "2026-11-02", "15:00", 2), { total: 400, hasPeak: false });
    assert.deepEqual(quoteCourtPrice(pricing, "2026-11-02", "16:00", 2), { total: 500, hasPeak: true }); // 4 PM base + 5 PM peak
    assert.equal(quoteCourtPrice(pricing, "2026-11-02", "21:00", 2).total, 500); // 9 PM peak + 10 PM base (window ends at 22:00)
});

test("overlapping windows: the highest rate wins; days without a window use the base rate", () => {
    assert.equal(hourlyRate(pricing, "2026-11-06", "19:00"), 350);
    assert.equal(hourlyRate(pricing, "2026-11-06", "18:00"), 300);
    assert.equal(hourlyRate(pricing, "2026-11-07", "07:00"), 200);
    assert.equal(hourlyRate(pricing, "2026-11-07", "08:00"), 280);
});

test("no peak windows means a flat base rate; 'from' price is the cheapest rate", () => {
    const flat = { settings: { base_hourly_rate: "250.00", min_hours: 1, max_hours: 3 }, peakRates: [] };
    assert.deepEqual(quoteCourtPrice(flat, "2026-11-02", "18:00", 3), { total: 750, hasPeak: false });
    assert.equal(lowestHourlyRate(flat), 250);
    assert.equal(lowestHourlyRate({ ...pricing, peakRates: [{ ...pricing.peakRates[0], hourly_rate: 150 }] }), 150);
});
