import test from "node:test";
import assert from "node:assert/strict";
import { parseSpotRequest } from "../src/lib/services/openPlay/openPlayTypes.ts";

test("parseSpotRequest accepts 1-4 spots and stripe/gcash only", () => {
    assert.deepEqual(parseSpotRequest({ sessionId: "s", spots: 2, payment_method: "gcash" }), { sessionId: "s", spots: 2, method: "gcash" });
    assert.deepEqual(parseSpotRequest({ sessionId: "s", spots: 4 }), { sessionId: "s", spots: 4, method: "stripe" });
    for (const spots of [0, 5, 2.5, "2", undefined]) assert.ok("error" in parseSpotRequest({ sessionId: "s", spots }), String(spots));
    assert.ok("error" in parseSpotRequest({ sessionId: "s", spots: 2, payment_method: "cash" }));
    assert.ok("error" in parseSpotRequest({ spots: 2 }));
    assert.ok("error" in parseSpotRequest(null));
});
