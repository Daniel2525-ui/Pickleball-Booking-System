import test from "node:test";
import assert from "node:assert/strict";

const { toStripeSession, qrExpiresAt } = await import("../src/lib/xendit.ts");

const pr = (status, extra = {}) => ({ payment_request_id: "pr-1", reference_id: "b", status, request_amount: 255, currency: "PHP", ...extra });

test("toStripeSession: only a succeeded QR is paid, only a dead one releases the hold", () => {
  const paid = toStripeSession(pr("SUCCEEDED", { latest_payment_id: "py-1" }));
  assert.equal(paid.payment_status, "paid");
  assert.equal(paid.payment_intent, "py-1");
  assert.equal(paid.amount_total, 25500);
  assert.equal(paid.currency, "php");

  for (const s of ["EXPIRED", "CANCELED", "FAILED"]) {
    assert.deepEqual([toStripeSession(pr(s)).status, toStripeSession(pr(s)).payment_status], ["expired", "unpaid"]);
  }
  // Still payable: cleanup must treat it as uncertain, never as expired
  assert.equal(toStripeSession(pr("REQUIRES_ACTION")).status, "complete");
  assert.equal(toStripeSession(pr("REQUIRES_ACTION")).payment_status, "unpaid");
});

test("qrExpiresAt: uses Xendit's expiry", () => {
  assert.equal(qrExpiresAt(pr("REQUIRES_ACTION", { channel_properties: { expires_at: "2026-11-10T04:27:23Z" } })), "2026-11-10T04:27:23Z");
});
