import test from "node:test";
import assert from "node:assert/strict";
import { tallySpots } from "../src/lib/services/openPlay/openPlayTypes.ts";

test("tallySpots counts confirmed rows and running holds, drops expired holds", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    const row = (s, spots, status, hold = null) => ({ open_play_session_id: s, open_play_spots: spots, status, hold_expires_at: hold });
    const { booked } = tallySpots([
        row("a", 2, "confirmed"),
        row("a", 1, "checked_in"),
        row("a", 3, "pending", "2026-11-05T10:05:00Z"), // hold still running
        row("a", 4, "pending", "2026-11-05T09:55:00Z"), // hold expired
        row("b", 2, "confirmed"),
    ], now);
    assert.equal(booked.get("a"), 6);
    assert.equal(booked.get("b"), 2);
    assert.equal(tallySpots([]).booked.size, 0);
});

test("summarizePastSessions counts spots that went ahead, spots played, and money kept", async () => {
    const { summarizePastSessions } = await import("../src/lib/services/openPlay/openPlayTypes.ts");
    const row = (s, spots, status, payments = []) => ({ open_play_session_id: s, open_play_spots: spots, status, payments });
    const sums = summarizePastSessions([
        row("a", 2, "completed", [{ status: "paid", amount: "300.00" }]),
        row("a", 1, "no_show", [{ status: "paid", amount: 150 }]),
        row("a", 1, "cancelled", [{ status: "refunded", amount: 150 }]), // refunded: not booked, not collected
        row("a", 1, "cancelled", [{ status: "paid", amount: 150 }]), // payment kept: collected, not booked
        row("b", 3, "completed", null),
    ]);
    assert.deepEqual(sums.get("a"), { booked: 3, played: 2, collected: 600 });
    assert.deepEqual(sums.get("b"), { booked: 3, played: 3, collected: 0 });
});
