import test from "node:test";
import assert from "node:assert/strict";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_for_tests";

const { isBookingActive, checkSlotAvailability } = await import(
  "../src/lib/services/bookings/checkSlotAvailability.service.ts"
);

test("checkSlotAvailability: handles null hold_expires_at with 35m created_at fallback and conservative invalid handling", () => {
  const now = new Date("2026-10-27T14:00:00Z");

  // 1. Pending booking created 10 minutes ago (within 35m) -> active hold
  const recentHold = {
    id: "b-1",
    status: "pending",
    hold_expires_at: null,
    created_at: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
  };
  assert.equal(isBookingActive(recentHold, now), true, "Hold within 35m fallback window must be active");

  // 2. Pending booking created 60 minutes ago (exceeded 35m hold + 20m grace) -> expired hold -> excluded
  const expiredFallbackHold = {
    id: "b-2",
    status: "pending",
    hold_expires_at: null,
    created_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
  };
  assert.equal(isBookingActive(expiredFallbackHold, now), false, "Hold created >55m ago must be treated as released");

  // 2b. Created 40 minutes ago: hold expired but still inside the 20-minute grace period -> still blocks
  const graceFallbackHold = { ...expiredFallbackHold, created_at: new Date(now.getTime() - 40 * 60 * 1000).toISOString() };
  assert.equal(isBookingActive(graceFallbackHold, now), true, "Expired hold inside the grace period must still block");

  // 2c. Explicit hold_expires_at: 5 minutes ago blocks (grace), 25 minutes ago does not
  const explicit = (minutesAgo) => ({ id: "b-2c", status: "pending", hold_expires_at: new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString() });
  assert.equal(isBookingActive(explicit(5), now), true, "Hold expired 5m ago is inside the grace period");
  assert.equal(isBookingActive(explicit(25), now), false, "Hold expired 25m ago is past the grace period");

  // 3. Conservative fallback: Missing or invalid timestamps fail safe to active (never silently free slot)
  const invalidDateString = {
    id: "b-3",
    status: "pending",
    hold_expires_at: "not-a-valid-date",
    created_at: "invalid",
  };
  assert.equal(isBookingActive(invalidDateString, now), true, "Invalid timestamps must fail conservatively to active");

  const nullTimestamps = {
    id: "b-4",
    status: "pending",
    hold_expires_at: null,
    created_at: null,
  };
  assert.equal(isBookingActive(nullTimestamps, now), true, "Null timestamps must fail conservatively to active");

  // 4. Future explicit hold_expires_at remains active
  const futureExplicitHold = {
    id: "b-5",
    status: "pending",
    hold_expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    created_at: new Date(now.getTime() - 50 * 60 * 1000).toISOString(),
  };
  assert.equal(isBookingActive(futureExplicitHold, now), true, "Future hold_expires_at takes precedence over created_at");

  // 5. Cancelled or no_show bookings never block availability
  const cancelledBooking = {
    id: "b-6",
    status: "cancelled",
    hold_expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };
  assert.equal(isBookingActive(cancelledBooking, now), false, "Cancelled booking must never block availability");

  const noShowBooking = {
    id: "b-7",
    status: "no_show",
    hold_expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };
  assert.equal(isBookingActive(noShowBooking, now), false, "no_show booking must never block availability");
});

test("checkSlotAvailability: slot status calculation correctly differentiates active holds, expired holds, and cancelled slots", () => {
  const courts = [{ id: "c-1", name: "Court 1", status: "active" }];
  const bookingDate = new Date("2029-10-27T10:00:00Z"); // Future date

  // Slot with only a hold that expired past the grace period -> available
  const expiredHold = [{
    id: "b-exp",
    court_id: "c-1",
    start_time: "10:00:00",
    end_time: "11:00:00",
    status: "pending",
    hold_expires_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  }];
  const statusExpired = checkSlotAvailability("Court 1", "10:00 AM - 11:00 AM", courts, expiredHold, bookingDate);
  assert.equal(statusExpired, "available");

  // Hold expired 5 minutes ago (inside the grace period) -> still taken; the owner sees it as their pending hold
  const graceHold = [{ ...expiredHold[0], user_id: "u-owner", hold_expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }];
  assert.equal(checkSlotAvailability("Court 1", "10:00 AM - 11:00 AM", courts, graceHold, bookingDate), "pending");
  assert.equal(checkSlotAvailability("Court 1", "10:00 AM - 11:00 AM", courts, graceHold, bookingDate, "u-owner"), "user_pending");

  // Slot with cancelled booking -> available
  const cancelledSlot = [{
    id: "b-canc",
    court_id: "c-1",
    start_time: "10:00:00",
    end_time: "11:00:00",
    status: "cancelled",
    created_at: new Date().toISOString(),
  }];
  const statusCancelled = checkSlotAvailability("Court 1", "10:00 AM - 11:00 AM", courts, cancelledSlot, bookingDate);
  assert.equal(statusCancelled, "available");

  // Slot with unexpired hold -> pending
  const activeHold = [{
    id: "b-act",
    court_id: "c-1",
    start_time: "10:00:00",
    end_time: "11:00:00",
    status: "pending",
    hold_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  }];
  const statusActive = checkSlotAvailability("Court 1", "10:00 AM - 11:00 AM", courts, activeHold, bookingDate);
  assert.equal(statusActive, "pending");
});

// cancel_expired_booking itself is covered against real Postgres in tests/integration/run-pg-integration.mjs
const { cleanupExpiredBooking } = await import("../src/lib/services/payments/cleanupExpiredBooking.ts");

/** Stripe and Supabase fakes recording what the cleanup did. */
function fakes(sessions, { cancelResult = { cancelled: true }, reconcileError = null } = {}) {
  const calls = { expired: [], cancelled: [], reconciled: [] };
  const stripeClient = {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          const s = sessions[id];
          if (s instanceof Error) throw s;
          return { id, ...s };
        },
        expire: async (id) => { calls.expired.push(id); },
      },
    },
  };
  const supabase = {
    rpc: async (fn, params) => {
      assert.equal(fn, "cancel_expired_booking");
      calls.cancelled.push(params);
      return { data: cancelResult, error: null };
    },
  };
  const reconcile = async (session) => {
    calls.reconciled.push(session.id);
    return { error: reconcileError };
  };
  return { calls, deps: { supabase, stripeClient, reconcile } };
}

const pending = (id, sessionIds) => ({
  id,
  payments: sessionIds.map((s, i) => ({ id: `p-${i}`, status: "pending", stripe_session_id: s, paid_at: null })),
});

test("cleanupExpiredBooking: keeps the hold when Stripe cannot be reached", async () => {
  const { calls, deps } = fakes({ cs_ok: { status: "open", payment_status: "unpaid" }, cs_err: new Error("Stripe 503") });
  assert.equal(await cleanupExpiredBooking(pending("b-1", ["cs_ok", "cs_err"]), deps), "skipped");
  assert.deepEqual(calls.cancelled, []);
});

test("cleanupExpiredBooking: keeps the hold when a session is complete but not yet paid", async () => {
  const { calls, deps } = fakes({ cs_delayed: { status: "complete", payment_status: "unpaid" } });
  assert.equal(await cleanupExpiredBooking(pending("b-1", ["cs_delayed"]), deps), "skipped");
  assert.deepEqual(calls.cancelled, []);
  assert.deepEqual(calls.reconciled, []);
});

test("cleanupExpiredBooking: never touches a booking with a settled payment row", async () => {
  const { calls, deps } = fakes({});
  const booking = { id: "b-1", payments: [{ id: "p-1", status: "paid", stripe_session_id: null, paid_at: null }] };
  assert.equal(await cleanupExpiredBooking(booking, deps), "skipped");
  assert.deepEqual(calls.cancelled, []);
});

test("cleanupExpiredBooking: expires every open session, then cancels with the pending payment", async () => {
  const { calls, deps } = fakes({ cs_1: { status: "open" }, cs_2: { status: "open" } });
  assert.equal(await cleanupExpiredBooking(pending("b-1", ["cs_1", "cs_2"]), deps), "cancelled");
  assert.deepEqual(calls.expired, ["cs_1", "cs_2"]);
  assert.deepEqual(calls.cancelled, [{ p_booking_id: "b-1", p_payment_id: "p-0" }]);
});

test("cleanupExpiredBooking: does not cancel when expiring an open session fails", async () => {
  const { calls, deps } = fakes({ cs_1: { status: "open" } });
  deps.stripeClient.checkout.sessions.expire = async () => { throw new Error("Stripe 500"); };
  assert.equal(await cleanupExpiredBooking(pending("b-1", ["cs_1"]), deps), "skipped");
  assert.deepEqual(calls.cancelled, []);
});

test("cleanupExpiredBooking: reconciles a paid session, expires the redundant one, never cancels", async () => {
  const { calls, deps } = fakes({ cs_open: { status: "open" }, cs_paid: { status: "complete", payment_status: "paid" } });
  assert.equal(await cleanupExpiredBooking(pending("b-1", ["cs_open", "cs_paid"]), deps), "reconciled");
  assert.deepEqual(calls.reconciled, ["cs_paid"]);
  assert.deepEqual(calls.expired, ["cs_open"]);
  assert.deepEqual(calls.cancelled, []);
});

test("cleanupExpiredBooking: a basket's shared paid session is reconciled once per run", async () => {
  const { calls, deps } = fakes({ cs_basket: { status: "complete", payment_status: "paid" } });
  const reconciledSessions = new Set();
  assert.equal(await cleanupExpiredBooking(pending("b-1", ["cs_basket"]), { ...deps, reconciledSessions }), "reconciled");
  assert.equal(await cleanupExpiredBooking(pending("b-2", ["cs_basket"]), { ...deps, reconciledSessions }), "skipped");
  assert.deepEqual(calls.reconciled, ["cs_basket"]);
});

test("cleanupExpiredBooking: a failed reconciliation is retried next run", async () => {
  const { deps } = fakes({ cs_paid: { status: "complete", payment_status: "paid" } }, { reconcileError: "lock timeout" });
  const reconciledSessions = new Set();
  assert.equal(await cleanupExpiredBooking(pending("b-1", ["cs_paid"]), { ...deps, reconciledSessions }), "skipped");
  assert.equal(reconciledSessions.size, 0);
});

test("cleanupExpiredBooking: reports skipped when the RPC refuses to cancel", async () => {
  const { deps } = fakes({}, { cancelResult: { cancelled: false, reason: "PAYMENT_SETTLED" } });
  assert.equal(await cleanupExpiredBooking({ id: "b-1", payments: [] }, deps), "skipped");
});

test("processStripePaymentReconciliation: reports error when settle_stripe_refund fails in database", async () => {
  const { processStripePaymentReconciliation } = await import(
    "../src/lib/services/payments/processStripePaymentReconciliation.ts"
  );

  const mockSupabase = {
    rpc: async (fn, params) => {
      if (fn === "reconcile_booking_payment") {
        return {
          data: {
            action: "REFUND_SCHEDULED",
            reason: "SLOT_CONFLICT",
            refund_request_id: "ref-conflict-123",
            idempotency_key: "idem-conflict-123",
          },
          error: null,
        };
      }
      if (fn === "settle_stripe_refund") {
        return {
          data: null,
          error: { message: "Simulated lock timeout in settle_stripe_refund" },
        };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    },
  };

  const outcome = await processStripePaymentReconciliation({
    bookingId: "b-conflict",
    paymentId: "p-conflict",
    amount: 200,
    currency: "php",
    stripeSessionId: "cs_conflict_123",
    stripePaymentIntent: "pi_conflict_123",
    supabase: mockSupabase,
    stripeClient: {
      refunds: {
        create: async () => ({ id: "re_mock_123", status: "succeeded" }),
      },
    },
  });

  assert.equal(outcome.success, false, "Must return success: false when database refund settlement fails");
  assert.equal(outcome.action, "REFUND_SCHEDULED");
  assert.ok(outcome.error?.includes("Simulated lock timeout in settle_stripe_refund"));
});
