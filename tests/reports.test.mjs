import test from "node:test";
import assert from "node:assert/strict";
import { periodRange, pctChange, reportCsv, transactionsCsv } from "../src/lib/services/reports/reports.ts";

test("this week runs Monday to Sunday around today, Sunday included", () => {
    assert.deepEqual(periodRange("week", "2026-11-05"), { from: "2026-11-02", to: "2026-11-08" });
    assert.deepEqual(periodRange("week", "2026-11-08"), { from: "2026-11-02", to: "2026-11-08" });
    assert.deepEqual(periodRange("week", "2026-11-02"), { from: "2026-11-02", to: "2026-11-08" });
});

test("this month and last month, across a leap-free February and a new year", () => {
    assert.deepEqual(periodRange("month", "2026-11-05"), { from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(periodRange("last_month", "2026-03-15"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(periodRange("last_month", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31" });
});

test("all time has no start, custom is taken as given", () => {
    assert.deepEqual(periodRange("all", "2026-11-05"), { from: null, to: "2026-11-05" });
    assert.deepEqual(periodRange("custom", "2026-11-05", { from: "2026-09-01", to: "2026-09-30" }), { from: "2026-09-01", to: "2026-09-30" });
});

test("percent change is whole, signed, and absent when there is nothing to compare", () => {
    assert.equal(pctChange(112, 100), 12);
    assert.equal(pctChange(90, 100), -10);
    assert.equal(pctChange(5, 0), null);
    assert.equal(pctChange(5, null), null);
    assert.equal(pctChange(5, undefined), null);
});

const row = (key, o = {}) => ({ key, net: 0, cash: 0, gcash: 0, card: 0, refunded: 0, bookings: 0, court_hours: 0, ...o });

test("the CSV has one plain line per day", () => {
    const report = {
        period: { from: "2026-10-01", to: "2026-10-02", through: "2026-10-02", bucket: "day" },
        series: [row("2026-10-01", { net: 600, cash: 400, gcash: 200, bookings: 3, court_hours: 4 }), row("2026-10-02")],
    };
    assert.equal(
        reportCsv(report),
        "Date,Bookings,Court hours,Cash,QR Ph,Refunded,Net\n2026-10-01,3,4,400,200,0,600\n2026-10-02,0,0,0,0,0,0\n",
    );
});

test("long periods are summed by month in the CSV", () => {
    const report = { period: { from: "2026-06-01", to: "2026-08-31", through: "2026-08-31", bucket: "month" }, series: [row("2026-06")] };
    assert.equal(reportCsv(report).split("\n")[0], "Month,Bookings,Court hours,Cash,QR Ph,Refunded,Net");
});

test("transactionsCsv: one line per movement, refunds negative, free text quoted", () => {
    const csv = transactionsCsv([
        { at: "2026-11-13 18:05", kind: "Payment", customer: "Dela Cruz, Juan", ref: "A1B2C3", item: "Court 1", method: "Cash", amount: 500, reference: "" },
        { at: "2026-11-15 12:00", kind: "Refund", customer: 'Ana "AJ" Reyes', ref: "D4E5F6", item: "Open play · 2 spots", method: "QR Ph", amount: -300, reference: "rf-123" },
    ]);
    assert.equal(csv,
        "Date and time,Type,Customer,Booking ref,Item,Method,Amount,Reference\n" +
        '2026-11-13 18:05,Payment,"Dela Cruz, Juan",A1B2C3,Court 1,Cash,500,\n' +
        '2026-11-15 12:00,Refund,"Ana ""AJ"" Reyes",D4E5F6,Open play · 2 spots,QR Ph,-300,rf-123\n');
});
