import test from "node:test";
import assert from "node:assert/strict";
import { validatePricingInput } from "../src/lib/services/pricing/validatePricingInput.ts";

const valid = {
    base_hourly_rate: 200,
    min_hours: 1,
    max_hours: 4,
    peak_rates: [{ label: " Weeknight ", days: ["Monday", "Friday", "Monday"], start_time: "17:00:00", end_time: "22:00", hourly_rate: 300 }],
};

test("accepts a valid form and normalizes it", () => {
    const r = validatePricingInput(valid);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value.peak_rates[0], { label: "Weeknight", days: ["Monday", "Friday"], start_time: "17:00", end_time: "22:00", hourly_rate: 300 });
});

test("rejects bad rates, lengths and windows", () => {
    const bad = (patch) => validatePricingInput({ ...valid, ...patch });
    const badPeak = (patch) => bad({ peak_rates: [{ ...valid.peak_rates[0], ...patch }] });
    for (const r of [
        bad({ base_hourly_rate: 0 }), bad({ base_hourly_rate: "200" }), bad({ base_hourly_rate: 1e6 }),
        bad({ min_hours: 3, max_hours: 2 }), bad({ min_hours: 0 }), bad({ max_hours: 13 }), bad({ min_hours: 1.5 }),
        bad({ peak_rates: "x" }), bad({ peak_rates: Array(21).fill(valid.peak_rates[0]) }),
        badPeak({ days: [] }), badPeak({ days: ["Funday"] }),
        badPeak({ start_time: "17:30" }), badPeak({ end_time: "17:00" }), badPeak({ hourly_rate: -5 }),
        validatePricingInput(null),
    ]) {
        assert.equal(r.ok, false, JSON.stringify(r));
    }
    assert.equal(bad({ peak_rates: [] }).ok, true, "No peak windows is a flat rate");
});
