import test from "node:test";
import assert from "node:assert/strict";
import { isPlayingNow, courtNowNext } from "../src/lib/services/courts/courtDay.ts";

const at = (time) => new Date(`2026-11-05T${time}+08:00`);
const slot = (start, end, fields = {}) => ({ court_id: "c1", booking_date: "2026-11-05", start_time: start, end_time: end, status: "confirmed", ...fields });

test("a slot ending at midnight is playing until 00:00", () => {
    assert.equal(isPlayingNow(slot("23:00:00", "00:00:00"), at("23:30:00")), true);
    assert.equal(isPlayingNow(slot("23:00:00", "00:00:00"), at("22:59:59")), false);
    assert.equal(isPlayingNow(slot("10:00:00", "11:00:00"), at("11:00:00")), false);
    assert.equal(isPlayingNow(slot("10:00:00", "11:00:00", { status: "in_progress" }), at("11:30:00")), true);
});

test("courtNowNext finds the current and the next booking on one court", () => {
    const slots = [
        slot("18:00:00", "19:00:00", { name: "later" }),
        slot("15:00:00", "16:00:00", { name: "now" }),
        slot("09:00:00", "10:00:00", { name: "done" }),
        slot("16:00:00", "17:00:00", { name: "other court", court_id: "c2" }),
    ];
    const { current, next } = courtNowNext(slots, "c1", at("15:30:00"));
    assert.equal(current.name, "now");
    assert.equal(next.name, "later");
    assert.deepEqual(courtNowNext(slots, "c1", at("19:00:00")), { current: null, next: null });
});

test("a booking waiting for GCash approval holds its court; an unpaid hold that ran out does not", () => {
    const gcash = slot("15:00:00", "16:00:00", { name: "gcash", status: "pending", hold_expires_at: "infinity" });
    const lapsed = slot("15:00:00", "16:00:00", { name: "lapsed", status: "pending", hold_expires_at: "2026-11-05T14:00:00+08:00", court_id: "c2" });
    const checkout = slot("17:00:00", "18:00:00", { name: "checkout", status: "pending", hold_expires_at: "2026-11-05T15:50:00+08:00" });
    assert.equal(courtNowNext([gcash, checkout], "c1", at("15:30:00")).current.name, "gcash");
    assert.equal(courtNowNext([gcash, checkout], "c1", at("15:30:00")).next.name, "checkout");
    assert.deepEqual(courtNowNext([lapsed], "c2", at("15:30:00")), { current: null, next: null });
});
