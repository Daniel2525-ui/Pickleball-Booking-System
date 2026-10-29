import test from "node:test";
import assert from "node:assert/strict";
import { summarizeVenueHours } from "../src/lib/utils/venueHours.ts";

const day = (day_of_week, open_time, close_time, is_open = true) => ({ day_of_week, open_time, close_time, is_open });

test("summarizeVenueHours: groups consecutive days and reports the overall range", () => {
    const rows = [
        day("Monday", "08:00", "22:00"), day("Tuesday", "08:00", "22:00"), day("Wednesday", "08:00", "22:00"),
        day("Thursday", "08:00", "22:00"), day("Friday", "08:00", "23:00"), day("Saturday", "07:00", "23:00"),
        day("Sunday", "08:00", "23:00"),
    ];
    assert.deepEqual(summarizeVenueHours(rows), {
        range: "7 AM – 11 PM",
        note: "Open daily · hours vary by day",
        groups: [
            { days: "Mon–Thu", hours: "8 AM – 10 PM" },
            { days: "Fri", hours: "8 AM – 11 PM" },
            { days: "Sat", hours: "7 AM – 11 PM" },
            { days: "Sun", hours: "8 AM – 11 PM" },
        ],
    });
});

test("summarizeVenueHours: uniform week and closed days", () => {
    const week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    assert.equal(summarizeVenueHours(week.map((d) => day(d, "07:00:00", "22:00:00"))).note, "Open 7 days a week");

    const closedSunday = summarizeVenueHours(week.map((d) => day(d, "09:30", "21:00", d !== "Sunday")));
    assert.equal(closedSunday.note, "Open 6 days a week");
    assert.deepEqual(closedSunday.groups.at(-1), { days: "Sun", hours: "Closed" });
    assert.equal(closedSunday.range, "9:30 AM – 9 PM");

    assert.equal(summarizeVenueHours([]), null);
});
