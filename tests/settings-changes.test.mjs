import test from "node:test";
import assert from "node:assert/strict";
import { describeSettingsChange } from "../src/lib/services/settings/settingsChanges.ts";

const g = (before, after) => describeSettingsChange({ area: "gcash", before, after });
const on = { account_name: "Juan Dela Cruz", number: "09171234567", qr_url: "https://x/qr1.png" };

test("describeSettingsChange words GCash changes for staff", () => {
    assert.deepEqual(g(on, { ...on, number: "09181112222" }), ["GCash number: 09171234567 → 09181112222"]);
    assert.deepEqual(g(on, { ...on, account_name: "Maria Santos" }), ["Account name: Juan Dela Cruz → Maria Santos"]);
    assert.deepEqual(g(on, { ...on, qr_url: "https://x/qr2.png" }), ["QR code replaced"]);
    assert.deepEqual(g(on, { ...on, qr_url: null }), ["QR code removed"]);
    assert.deepEqual(g(on, { account_name: null, number: null, qr_url: "https://x/qr1.png" }), ["GCash turned off"]);
    assert.deepEqual(g({ account_name: null, number: null, qr_url: null }, { ...on, qr_url: null }), ["GCash turned on", "GCash number: 09171234567", "Account name: Juan Dela Cruz"]);
});

test("describeSettingsChange lists any other area field by field", () => {
    assert.deepEqual(describeSettingsChange({ area: "contact", before: { venue_phone: null }, after: { venue_phone: "09170000000" } }), ["venue phone: (empty) → 09170000000"]);
});

test("describeSettingsChange words staff access changes", () => {
    const change = (from, to) => describeSettingsChange({ area: "staff", before: { account: "ana@x.ph", access: from }, after: { account: "ana@x.ph", access: to } });
    assert.deepEqual(change("customer", "admin"), ["ana@x.ph: given staff access"]);
    assert.deepEqual(change("admin", "customer"), ["ana@x.ph: staff access removed"]);
});

test("describeSettingsChange words booking rule changes", () => {
    assert.deepEqual(
        describeSettingsChange({ area: "policy", before: { cancel_cutoff_hours: 2, no_show_grace_minutes: 15 }, after: { cancel_cutoff_hours: 4, no_show_grace_minutes: 15 } }),
        ["Online cancellation closes: 2 → 4 hours before start"]
    );
});
