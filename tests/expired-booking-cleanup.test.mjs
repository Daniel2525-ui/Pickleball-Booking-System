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

/**
 * Pure simulation of the enhanced cancel_expired_booking RPC logic
 * matching supabase/migrations/20261030_cancel_expired_booking_resilience.sql
 */
function simulateCancelExpiredBookingRpc({
  bookingId,
  paymentId,
  booking,
  payments = [],
  refundRequests = [],
  now = new Date(),
}) {
  if (!booking || booking.id !== bookingId) {
    return { cancelled: false, reason: "BOOKING_NOT_FOUND" };
  }

  if (booking.status !== "pending") {
    return { cancelled: false, reason: "BOOKING_NOT_PENDING", status: booking.status };
  }

  const effectiveExpiry = booking.hold_expires_at
    ? new Date(booking.hold_expires_at)
    : new Date(new Date(booking.created_at).getTime() + 35 * 60 * 1000);

  if (effectiveExpiry > now) {
    return { cancelled: false, reason: "HOLD_NOT_EXPIRED", hold_expires_at: booking.hold_expires_at };
  }

  // Guard: Settled payments
  const hasSettledPayment = payments.some(
    (p) => ["paid", "succeeded", "refunded"].includes((p.status || "").toLowerCase()) || Boolean(p.paid_at)
  );
  if (hasSettledPayment) {
    return { cancelled: false, reason: "PAYMENT_ALREADY_SETTLED" };
  }

  // Guard: Refund ledger
  const hasActiveRefund = refundRequests.some(
    (r) => ["pending", "processing", "succeeded", "pending_cash_handover", "cash_refunded", "requires_admin_review"].includes((r.status || "").toLowerCase())
  );
  if (hasActiveRefund) {
    return { cancelled: false, reason: "REFUND_IN_PROGRESS" };
  }

  // Payment row lock & update
  if (paymentId) {
    const payment = payments.find((p) => p.id === paymentId && p.booking_id === bookingId);
    if (!payment) {
      return { cancelled: false, reason: "PAYMENT_NOT_FOUND" };
    }
    if (payment.status === "pending") {
      payment.status = "failed";
    }
  } else {
    // Null payment ID: mark any pending payments as failed
    for (const p of payments) {
      if (p.booking_id === bookingId && p.status === "pending") {
        p.status = "failed";
      }
    }
  }

  booking.status = "cancelled";
  booking.updated_at = now.toISOString();

  return { cancelled: true, booking_id: bookingId, payment_id: paymentId };
}

test("cancel_expired_booking RPC: allows cancellation when p_payment_id is null (0 payments)", () => {
  const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const booking = { id: "b-zero-pay", status: "pending", hold_expires_at: pastExpiry, created_at: pastExpiry };

  const res = simulateCancelExpiredBookingRpc({
    bookingId: "b-zero-pay",
    paymentId: null,
    booking,
    payments: [],
  });

  assert.equal(res.cancelled, true);
  assert.equal(booking.status, "cancelled");
});

test("cancel_expired_booking RPC: cancels booking when existing payment is already 'failed'", () => {
  const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const booking = { id: "b-failed-pay", status: "pending", hold_expires_at: pastExpiry, created_at: pastExpiry };
  const payments = [{ id: "p-failed", booking_id: "b-failed-pay", status: "failed" }];

  const res = simulateCancelExpiredBookingRpc({
    bookingId: "b-failed-pay",
    paymentId: "p-failed",
    booking,
    payments,
  });

  assert.equal(res.cancelled, true);
  assert.equal(booking.status, "cancelled");
  assert.equal(payments[0].status, "failed");
});

test("cancel_expired_booking RPC: refuses cancellation if payment is settled ('paid', 'succeeded', 'refunded', or paid_at)", () => {
  const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Case A: status = 'paid'
  const bPaid = { id: "b-paid", status: "pending", hold_expires_at: pastExpiry, created_at: pastExpiry };
  const pPaid = [{ id: "p-1", booking_id: "b-paid", status: "paid" }];
  const resPaid = simulateCancelExpiredBookingRpc({
    bookingId: "b-paid",
    paymentId: "p-1",
    booking: bPaid,
    payments: pPaid,
  });
  assert.equal(resPaid.cancelled, false);
  assert.equal(resPaid.reason, "PAYMENT_ALREADY_SETTLED");
  assert.equal(bPaid.status, "pending");

  // Case B: status = 'succeeded'
  const bSucc = { id: "b-succ", status: "pending", hold_expires_at: pastExpiry, created_at: pastExpiry };
  const pSucc = [{ id: "p-2", booking_id: "b-succ", status: "succeeded" }];
  const resSucc = simulateCancelExpiredBookingRpc({
    bookingId: "b-succ",
    paymentId: "p-2",
    booking: bSucc,
    payments: pSucc,
  });
  assert.equal(resSucc.cancelled, false);
  assert.equal(resSucc.reason, "PAYMENT_ALREADY_SETTLED");

  // Case C: paid_at is set
  const bPaidAt = { id: "b-paidat", status: "pending", hold_expires_at: pastExpiry, created_at: pastExpiry };
  const pPaidAt = [{ id: "p-3", booking_id: "b-paidat", status: "pending", paid_at: new Date().toISOString() }];
  const resPaidAt = simulateCancelExpiredBookingRpc({
    bookingId: "b-paidat",
    paymentId: "p-3",
    booking: bPaidAt,
    payments: pPaidAt,
  });
  assert.equal(resPaidAt.cancelled, false);
  assert.equal(resPaidAt.reason, "PAYMENT_ALREADY_SETTLED");
});

test("cancel_expired_booking RPC: refuses cancellation if refund is in progress", () => {
  const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const booking = { id: "b-ref", status: "pending", hold_expires_at: pastExpiry, created_at: pastExpiry };
  const refundRequests = [{ id: "ref-1", booking_id: "b-ref", status: "processing" }];

  const res = simulateCancelExpiredBookingRpc({
    bookingId: "b-ref",
    paymentId: null,
    booking,
    payments: [],
    refundRequests,
  });

  assert.equal(res.cancelled, false);
  assert.equal(res.reason, "REFUND_IN_PROGRESS");
  assert.equal(booking.status, "pending");
});

/**
 * Pure simulation of the hardened cleanup route workflow in
 * src/app/api/cron/cleanup-expired-bookings/route.ts
 */
async function simulateCronCleanup({
  bookings,
  stripeMock,
  reconcileServiceMock,
  rpcMock,
  maxBudgetMs = 6000,
  batchSize = 25,
}) {
  const startTime = Date.now();
  const skippedIds = [];
  let cancelledCount = 0;
  let reconciledCount = 0;
  let totalProcessed = 0;

  while (Date.now() - startTime < maxBudgetMs) {
    const availableCandidates = bookings.filter(
      (b) => b.status === "pending" && !skippedIds.includes(b.id)
    );
    const batch = availableCandidates.slice(0, batchSize);

    if (batch.length === 0) break;

    for (const booking of batch) {
      if (Date.now() - startTime >= maxBudgetMs) break;
      totalProcessed++;

      try {
        const payments = booking.payments || [];

        // 1. Check settled payments in DB
        const hasSettledPayment = payments.some(
          (p) => ["paid", "succeeded", "refunded"].includes((p.status || "").toLowerCase()) || Boolean(p.paid_at)
        );

        if (hasSettledPayment) {
          skippedIds.push(booking.id);
          continue;
        }

        // 2. Check Stripe status for all payments associated with this booking
        let isStripeUncertain = false;
        let paidPaymentInfo = null;
        const openSessionsToExpire = [];

        for (const payment of payments) {
          if (!payment.stripe_session_id) continue;

          try {
            const session = await stripeMock.retrieve(payment.stripe_session_id);

            if (session.payment_status === "paid") {
              if (!paidPaymentInfo) {
                paidPaymentInfo = { payment, session };
              }
            } else if (session.status === "complete") {
              // Complete session with unpaid/delayed payment status is uncertain
              isStripeUncertain = true;
            } else if (session.status === "open") {
              openSessionsToExpire.push(session.id);
            } else if (session.status === "expired") {
              // Safely expired
            } else {
              isStripeUncertain = true;
            }
          } catch {
            isStripeUncertain = true;
            break;
          }
        }

        if (isStripeUncertain) {
          skippedIds.push(booking.id);
          continue;
        }

        if (paidPaymentInfo) {
          // Expire redundant open sessions
          for (const openId of openSessionsToExpire) {
            try {
              await stripeMock.expire(openId);
            } catch {
              // Non-blocking warning
            }
          }

          const recOutcome = await reconcileServiceMock({
            bookingId: booking.id,
            paymentId: paidPaymentInfo.payment.id,
          });

          if (recOutcome.success) {
            reconciledCount++;
            booking.status = "confirmed";
          }
          skippedIds.push(booking.id);
          continue;
        }

        // Expire all open sessions
        let expireFailed = false;
        for (const openId of openSessionsToExpire) {
          try {
            await stripeMock.expire(openId);
          } catch {
            expireFailed = true;
            break;
          }
        }

        if (expireFailed) {
          skippedIds.push(booking.id);
          continue;
        }

        // 3. Find pending payment (if any)
        const pendingPayment = payments.find((p) => p.status === "pending");

        // 4. Call cancel_expired_booking RPC
        const cancelResult = await rpcMock({
          p_booking_id: booking.id,
          p_payment_id: pendingPayment?.id ?? null,
        });

        if (cancelResult?.cancelled) {
          cancelledCount++;
          booking.status = "cancelled";
        } else {
          skippedIds.push(booking.id);
        }
      } catch {
        skippedIds.push(booking.id);
      }
    }

    if (batch.length < batchSize) break;
  }

  return { cancelledCount, reconciledCount, totalProcessed, skippedIds };
}

test("Cron Cleanup: preserves bookings when Stripe Checkout session retrieval fails (uncertain status)", async () => {
  const bookings = [
    {
      id: "b-uncertain",
      status: "pending",
      payments: [{ id: "p-1", status: "pending", stripe_session_id: "cs_timeout" }],
    },
  ];

  const stripeMock = {
    retrieve: async () => {
      throw new Error("Stripe network timeout / 503");
    },
    expire: async () => {},
  };

  let rpcCalls = 0;
  const rpcMock = async () => {
    rpcCalls++;
    return { cancelled: true };
  };

  const res = await simulateCronCleanup({
    bookings,
    stripeMock,
    reconcileServiceMock: async () => ({ success: true }),
    rpcMock,
  });

  assert.equal(res.cancelledCount, 0, "Must not cancel when Stripe status is uncertain");
  assert.equal(rpcCalls, 0, "Must not call cancel RPC when Stripe status is uncertain");
  assert.equal(bookings[0].status, "pending", "Booking remains pending for next retry");
  assert.deepEqual(res.skippedIds, ["b-uncertain"]);
});

test("Cron Cleanup: preserves bookings when Stripe Checkout session is complete but payment is unpaid/delayed", async () => {
  const bookings = [
    {
      id: "b-delayed",
      status: "pending",
      payments: [{ id: "p-delayed", status: "pending", stripe_session_id: "cs_delayed_123" }],
    },
  ];

  const stripeMock = {
    retrieve: async () => ({ id: "cs_delayed_123", status: "complete", payment_status: "unpaid" }),
    expire: async () => {},
  };

  let rpcCalls = 0;
  let reconcileCalls = 0;

  const res = await simulateCronCleanup({
    bookings,
    stripeMock,
    reconcileServiceMock: async () => {
      reconcileCalls++;
      return { success: true };
    },
    rpcMock: async () => {
      rpcCalls++;
      return { cancelled: true };
    },
  });

  assert.equal(res.cancelledCount, 0, "Must never cancel a booking with delayed/unpaid complete session");
  assert.equal(rpcCalls, 0, "Must not call cancel RPC");
  assert.equal(reconcileCalls, 0, "Must not reconcile complete session as paid when payment_status is unpaid");
  assert.equal(bookings[0].status, "pending");
  assert.deepEqual(res.skippedIds, ["b-delayed"]);
});

test("Cron Cleanup: handles multiple sessions per booking: expires all open sessions before cancelling", async () => {
  const bookings = [
    {
      id: "b-multi-open",
      status: "pending",
      payments: [
        { id: "p-1", status: "pending", stripe_session_id: "cs_open_1" },
        { id: "p-2", status: "pending", stripe_session_id: "cs_open_2" },
      ],
    },
  ];

  const expiredSessionIds = [];
  const stripeMock = {
    retrieve: async (id) => ({ id, status: "open", payment_status: "unpaid" }),
    expire: async (id) => {
      expiredSessionIds.push(id);
    },
  };

  const res = await simulateCronCleanup({
    bookings,
    stripeMock,
    reconcileServiceMock: async () => ({ success: true }),
    rpcMock: async ({ p_booking_id }) => ({ cancelled: true, booking_id: p_booking_id }),
  });

  assert.equal(res.cancelledCount, 1);
  assert.deepEqual(expiredSessionIds, ["cs_open_1", "cs_open_2"], "All open sessions must be expired before cancellation");
  assert.equal(bookings[0].status, "cancelled");
});

test("Cron Cleanup: handles multiple sessions per booking: reconciles paid session and expires redundant open session", async () => {
  const bookings = [
    {
      id: "b-multi-paid",
      status: "pending",
      payments: [
        { id: "p-open", status: "pending", stripe_session_id: "cs_open_redundant" },
        { id: "p-paid", status: "pending", stripe_session_id: "cs_paid_actual" },
      ],
    },
  ];

  const expiredSessionIds = [];
  const stripeMock = {
    retrieve: async (id) => {
      if (id === "cs_open_redundant") return { id, status: "open", payment_status: "unpaid" };
      if (id === "cs_paid_actual") return { id, status: "complete", payment_status: "paid" };
      throw new Error(`Unexpected session ID: ${id}`);
    },
    expire: async (id) => {
      expiredSessionIds.push(id);
    },
  };

  let reconciledPaymentId = null;
  const res = await simulateCronCleanup({
    bookings,
    stripeMock,
    reconcileServiceMock: async ({ paymentId }) => {
      reconciledPaymentId = paymentId;
      return { success: true };
    },
    rpcMock: async () => {
      throw new Error("Must never call cancel RPC for paid booking");
    },
  });

  assert.equal(res.reconciledCount, 1);
  assert.equal(res.cancelledCount, 0);
  assert.equal(reconciledPaymentId, "p-paid");
  assert.deepEqual(expiredSessionIds, ["cs_open_redundant"], "Redundant open session must be expired to prevent duplicate payment");
  assert.equal(bookings[0].status, "confirmed");
});

test("Cron Cleanup: multi-session booking skips cancellation if any session's retrieval fails", async () => {
  const bookings = [
    {
      id: "b-multi-fail",
      status: "pending",
      payments: [
        { id: "p-1", status: "pending", stripe_session_id: "cs_ok" },
        { id: "p-2", status: "pending", stripe_session_id: "cs_err" },
      ],
    },
  ];

  const stripeMock = {
    retrieve: async (id) => {
      if (id === "cs_ok") return { id, status: "open", payment_status: "unpaid" };
      throw new Error("Stripe 500 error on cs_err");
    },
    expire: async () => {},
  };

  let rpcCalls = 0;
  const res = await simulateCronCleanup({
    bookings,
    stripeMock,
    reconcileServiceMock: async () => ({ success: true }),
    rpcMock: async () => {
      rpcCalls++;
      return { cancelled: true };
    },
  });

  assert.equal(res.cancelledCount, 0, "Must not cancel if any session status fails verification");
  assert.equal(rpcCalls, 0);
  assert.deepEqual(res.skippedIds, ["b-multi-fail"]);
});

test("Cron Cleanup: multi-batch processing drains backlog across pages and isolates per-booking errors", async () => {
  const bookings = Array.from({ length: 60 }, (_, i) => ({
    id: `b-${i}`,
    status: "pending",
    payments: [],
  }));

  const stripeMock = {
    retrieve: async () => ({ status: "expired" }),
    expire: async () => {},
  };

  const res = await simulateCronCleanup({
    bookings,
    stripeMock,
    reconcileServiceMock: async () => ({ success: true }),
    rpcMock: async ({ p_booking_id }) => {
      if (p_booking_id === "b-5") {
        throw new Error("Simulated transient lock collision on b-5");
      }
      return { cancelled: true, booking_id: p_booking_id };
    },
    batchSize: 25,
  });

  assert.equal(res.totalProcessed, 60, "Must process all 60 bookings across multiple batches");
  assert.equal(res.cancelledCount, 59, "All 59 valid bookings cancelled");
  assert.deepEqual(res.skippedIds, ["b-5"], "Only the single failed booking was skipped");
  assert.equal(bookings.find((b) => b.id === "b-5").status, "pending");
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
