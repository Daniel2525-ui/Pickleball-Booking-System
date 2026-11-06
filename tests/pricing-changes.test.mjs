import test from "node:test";
import assert from "node:assert/strict";
import { pricingChanges } from "../src/lib/services/pricing/pricingChanges.ts";

const pricing = (base, peaks = [], min = 1, max = 3) => ({ settings: { base_hourly_rate: base, min_hours: min, max_hours: max }, peakRates: peaks });
const peak = (rate, fields = {}) => ({ label: "Evening", days: ["Monday", "Friday"], start_time: "17:00", end_time: "22:00", hourly_rate: rate, ...fields });

test("pricingChanges lists what changed and flags likely typos", () => {
    assert.deepEqual(pricingChanges(pricing(200), pricing(200)), []);
    assert.deepEqual(pricingChanges(pricing(200), pricing(250)), ["Base rate: ₱200 → ₱250 per hour"]);
    assert.deepEqual(pricingChanges(pricing(250), pricing(2500)), ["Base rate: ₱250 → ₱2,500 per hour (more than double)"]);
    assert.deepEqual(pricingChanges(pricing(250), pricing(25)), ["Base rate: ₱250 → ₱25 per hour (less than half)"]);
    assert.deepEqual(pricingChanges(pricing(200, [], 1, 3), pricing(200, [], 2, 3)), ["Minimum booking: 1 → 2 hours"]);
    // The old maximum is no longer a setting: changing it alone is not a change
    assert.deepEqual(pricingChanges(pricing(200, [], 1, 3), pricing(200, [], 1, 12)), []);
});

test("pricingChanges compares peak windows regardless of day order or time format", () => {
    const saved = pricing(200, [peak(300, { start_time: "17:00:00", end_time: "22:00:00", days: ["Friday", "Monday"] })]);
    assert.deepEqual(pricingChanges(saved, pricing(200, [peak(300)])), []);
    assert.deepEqual(pricingChanges(saved, pricing(200, [peak(350)])), ["Peak window removed: Evening (₱300/hr)", "Peak window: Evening at ₱350/hr"]);
    assert.deepEqual(pricingChanges(pricing(200), pricing(200, [peak(3000, { label: "" })])), ["Peak window: Unnamed at ₱3,000/hr (far from the base rate)"]);
});
