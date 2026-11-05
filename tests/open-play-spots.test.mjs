import test from "node:test";
import assert from "node:assert/strict";
import { tallySpots } from "../src/lib/services/openPlay/openPlayTypes.ts";

test("tallySpots counts confirmed rows and running holds, drops expired holds, flags GCash awaiting", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    const row = (s, spots, status, hold = null) => ({ open_play_session_id: s, open_play_spots: spots, status, hold_expires_at: hold });
    const { booked, awaiting } = tallySpots([
        row("a", 2, "confirmed"),
        row("a", 1, "checked_in"),
        row("a", 3, "pending", "2026-11-05T10:05:00Z"), // hold still running
        row("a", 4, "pending", "2026-11-05T09:55:00Z"), // hold expired
        row("b", 2, "pending", "infinity"), // GCash proof waiting for staff
    ], now);
    assert.equal(booked.get("a"), 6);
    assert.equal(booked.get("b"), 2);
    assert.deepEqual([...awaiting], ["b"]);
    assert.equal(tallySpots([]).booked.size, 0);
});
