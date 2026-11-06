import test from "node:test";
import assert from "node:assert/strict";
import { courtShowcaseStatus } from "../src/lib/services/courts/courtShowcase.ts";

const today = "2026-11-07";
const at = (hm) => new Date(`${today}T${hm}:00+08:00`);
const open = { is_open: true, open_time: "08:00:00", close_time: "22:00:00" };
const court = { id: "c1", status: "active", maintenance_note: null };
const slot = (start, end, status = "confirmed", court_id = "c1") => ({ court_id, start_time: `${start}:00`, end_time: `${end}:00`, status });

test("a court under maintenance or closed is off, with its note", () => {
    const m = { ...court, status: "maintenance", maintenance_note: "Resurfacing" };
    assert.deepEqual(courtShowcaseStatus(m, [], open, today, at("10:00")), { state: "off", label: "Maintenance", detail: "Resurfacing" });
    assert.equal(courtShowcaseStatus({ ...m, maintenance_note: null }, [], open, today, at("10:00")).detail, "Not bookable right now");
    assert.equal(courtShowcaseStatus({ ...court, status: "closed" }, [], open, today, at("10:00")).label, "Closed");
});

test("outside opening hours no court reads as free", () => {
    assert.deepEqual(courtShowcaseStatus(court, [], open, today, at("23:00")), { state: "off", label: "Closed now", detail: "Closed for the day" });
    assert.equal(courtShowcaseStatus(court, [], open, today, at("07:00")).detail, "Opens 8:00 AM");
    assert.equal(courtShowcaseStatus(court, [], { ...open, is_open: false }, today, at("10:00")).detail, "Closed for the day");
    assert.equal(courtShowcaseStatus(court, [], null, today, at("10:00")).detail, "Closed for the day");
});

test("in play until the end of back-to-back bookings, someone else's hold included", () => {
    const slots = [slot("15:00", "16:00"), slot("16:00", "17:00", "pending")];
    assert.deepEqual(courtShowcaseStatus(court, slots, open, today, at("15:30")), { state: "busy", label: "In play", detail: "Free from 5:00 PM" });
});

test("free until the next booking, or for the rest of the day", () => {
    assert.deepEqual(courtShowcaseStatus(court, [slot("18:00", "19:00")], open, today, at("15:30")), { state: "free", label: "Free now", detail: "Free until 6:00 PM" });
    assert.equal(courtShowcaseStatus(court, [], open, today, at("15:30")).detail, "No more bookings today");
    assert.equal(courtShowcaseStatus(court, [slot("15:00", "16:00", "confirmed", "c2")], open, today, at("15:30")).label, "Free now");
});
