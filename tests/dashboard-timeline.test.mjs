import test from "node:test";
import assert from "node:assert/strict";
import { timelineRange, timelineBlock } from "../src/lib/services/dashboard/timeline.ts";

const open = (day, o, c) => ({ day_of_week: day, is_open: true, open_time: o, close_time: c });

test("timelineRange: the day's hours, a late close past 24, widened for bookings outside them", () => {
  assert.deepEqual(timelineRange([open("Friday", "07:00", "22:00")], "Friday", []), { from: 7, to: 22 });
  assert.deepEqual(timelineRange([open("Friday", "07:00", "01:00")], "Friday", []), { from: 7, to: 25 });
  assert.deepEqual(timelineRange([], "Friday", []), { from: 7, to: 22 });
  const early = [{ booking_date: "2026-11-13", start_time: "06:00:00", end_time: "07:00:00" }];
  assert.deepEqual(timelineRange([open("Friday", "07:00", "22:00")], "Friday", early, "2026-11-13"), { from: 6, to: 22 });
  const late = [{ booking_date: "2026-11-14", start_time: "00:00:00", end_time: "02:00:00" }];
  assert.deepEqual(timelineRange([open("Friday", "07:00", "01:00")], "Friday", late, "2026-11-13"), { from: 7, to: 26 });
});

test("timelineBlock: grid columns after the label column, after-midnight at the end, clipped to the range", () => {
  const range = { from: 7, to: 25 };
  assert.deepEqual(timelineBlock({ booking_date: "2026-11-13", start_time: "07:00:00", end_time: "09:00:00" }, "2026-11-13", range), { from: 2, to: 4 });
  assert.deepEqual(timelineBlock({ booking_date: "2026-11-13", start_time: "23:00:00", end_time: "24:00:00" }, "2026-11-13", range), { from: 18, to: 19 });
  assert.deepEqual(timelineBlock({ booking_date: "2026-11-14", start_time: "00:00:00", end_time: "01:00:00" }, "2026-11-13", range), { from: 19, to: 20 });
  assert.equal(timelineBlock({ booking_date: "2026-11-13", start_time: "05:00:00", end_time: "06:00:00" }, "2026-11-13", range), null);
});
