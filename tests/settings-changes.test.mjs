import test from "node:test";
import assert from "node:assert/strict";
import { describeSettingsChange } from "../src/lib/services/settings/settingsChanges.ts";

test("describeSettingsChange lists any other area field by field", () => {
    assert.deepEqual(describeSettingsChange({ area: "contact", before: { venue_phone: null }, after: { venue_phone: "09170000000" } }), ["venue phone: (empty) → 09170000000"]);
});

test("describeSettingsChange words staff access changes", () => {
    const change = (from, to) => describeSettingsChange({ area: "staff", before: { account: "ana@x.ph", access: from }, after: { account: "ana@x.ph", access: to } });
    assert.deepEqual(change("none", "staff"), ["ana@x.ph: given front desk access"]);
    assert.deepEqual(change("none", "owner"), ["ana@x.ph: given admin access"]);
    assert.deepEqual(change("staff", "owner"), ["ana@x.ph: front desk → admin"]);
    assert.deepEqual(change("owner", "none"), ["ana@x.ph: staff access removed"]);
    // Rows written before owners existed
    assert.deepEqual(change("customer", "admin"), ["ana@x.ph: given front desk access"]);
    assert.deepEqual(change("admin", "customer"), ["ana@x.ph: staff access removed"]);
});

test("describeSettingsChange words booking rule changes", () => {
    assert.deepEqual(
        describeSettingsChange({ area: "policy", before: { cancel_cutoff_hours: 2, no_show_grace_minutes: 15 }, after: { cancel_cutoff_hours: 4, no_show_grace_minutes: 15 } }),
        ["Online cancellation closes: 2 → 4 hours before start"]
    );
});
