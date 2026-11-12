import test from "node:test";
import assert from "node:assert/strict";

const { toStripeSession, qrExpiresAt, isXenditId } = await import("../src/lib/xendit.ts");

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

test("isXenditId: Xendit ids go to the record-only refund, Stripe ids do not", () => {
  assert.equal(isXenditId("py-cb1e6229"), true);
  assert.equal(isXenditId("pr-37f35e08"), true);
  assert.equal(isXenditId("pi_3Qabc"), false);
  assert.equal(isXenditId(null), false);
});

test("qrExpiresAt: uses Xendit's expiry", () => {
  assert.equal(qrExpiresAt(pr("REQUIRES_ACTION", { channel_properties: { expires_at: "2026-11-10T04:27:23Z" } })), "2026-11-10T04:27:23Z");
});

test("closeQrPayment: paid stays paid, a payable QR is cancelled, a QR that won't cancel blocks the cancellation", async () => {
    const { closeQrPayment } = await import("../src/lib/xendit.ts");
    const api = (states, cancel) => {
        const seen = [...states];
        return { get: async () => pr(seen.length > 1 ? seen.shift() : seen[0]), cancel: cancel ?? (async () => pr("CANCELED")) };
    };
    assert.equal(await closeQrPayment("pr-1", api(["SUCCEEDED"])), "paid");
    assert.equal(await closeQrPayment("pr-1", api(["EXPIRED"])), "closed");
    assert.equal(await closeQrPayment("pr-1", api(["REQUIRES_ACTION"])), "closed");
    // Paid in the same moment: Xendit refuses the cancel, and the QR now reads paid
    assert.equal(await closeQrPayment("pr-1", api(["REQUIRES_ACTION", "SUCCEEDED"], async () => { throw new Error("400"); })), "paid");
    // Still payable and Xendit won't cancel it: the booking must not be cancelled
    await assert.rejects(closeQrPayment("pr-1", api(["REQUIRES_ACTION"], async () => { throw new Error("503"); })));
});
