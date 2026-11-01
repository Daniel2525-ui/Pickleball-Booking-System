import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { cleanupExpiredBooking } from "@/lib/services/payments/cleanupExpiredBooking";
import { processPendingRefundJobs } from "@/lib/services/payments/refundWorker.ts";
import { isAuthorizedCronRequest } from "@/lib/utils/cronAuth";

/**
 * Cleanup cron job for expired reservation holds.
 * Triggered every 15 minutes by Supabase Cron (supabase/migrations/20261028153353_20261103_supabase_cron_cleanup.sql).
 *
 * Concurrency & Safety Guarantees:
 * 1. Authenticates request via Authorization: Bearer <CRON_SECRET>.
 * 2. Processes in bounded batches (BATCH_SIZE = 25) within time budgets (6000 ms for cleanup, 8000 ms total)
 *    to comfortably finish before Vercel serverless limits while draining backlogs across multiple iterations.
 * 3. Inspects Stripe Checkout sessions before performing database cancellation.
 * 4. If Stripe session is paid or complete, reconciles via reconcileCheckoutSession
 *    instead of cancelling.
 * 5. If Stripe session is open, expires the Stripe session to prevent late checkout.
 * 6. If Stripe API retrieval throws an error (network drop, timeout, 5xx), treats status as UNCERTAIN
 *    and skips cancellation for this booking in this run. Never assumes an API error means unpaid.
 * 7. Calls cancel_expired_booking RPC, which enforces FOR UPDATE row locks (Level 1 bookings -> Level 3 payments)
 *    and checks that no payment was settled (paid, succeeded, refunded, paid_at) before cancelling.
 * 8. Individual booking failures are isolated in try/catch and added to skippedIds to prevent
 *    starvation and ensure queue progress.
 */
export async function GET(request: Request) {
  try {
    if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getServiceClient();
    if (!supabase) {
      console.error("Cron configuration error: SUPABASE_SERVICE_ROLE_KEY is required to bypass RLS.");
      return NextResponse.json(
        { error: "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is missing." },
        { status: 500 }
      );
    }
    const BATCH_SIZE = 25;
    const TOTAL_BUDGET_MS = 8000;
    const CLEANUP_LOOP_BUDGET_MS = 6000;
    const startTime = Date.now();
    const skippedIds: string[] = [];
    const reconciledSessions = new Set<string>();

    let reconciledCount = 0;
    let cancelledCount = 0;
    let totalProcessed = 0;

    while (Date.now() - startTime < CLEANUP_LOOP_BUDGET_MS) {
      const nowIso = new Date().toISOString();
      const fallbackCutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString();

      let query = supabase
        .from("bookings")
        .select(`
          id,
          status,
          created_at,
          hold_expires_at,
          payments(
            id,
            status,
            stripe_session_id,
            stripe_payment_id,
            amount,
            currency,
            paid_at
          )
        `)
        .eq("status", "pending")
        .or(`hold_expires_at.lte.${nowIso},and(hold_expires_at.is.null,created_at.lt.${fallbackCutoff})`)
        .order("created_at", { ascending: true })
        .limit(BATCH_SIZE);

      if (skippedIds.length > 0) {
        query = query.not("id", "in", `(${skippedIds.join(",")})`);
      }

      const { data: expiredBookings, error: fetchError } = await query;

      if (fetchError) {
        console.error("Error fetching expired bookings batch:", fetchError);
        break;
      }

      if (!expiredBookings || expiredBookings.length === 0) {
        break; // Drained queue
      }

      for (const booking of expiredBookings) {
        // Enforce time budget between bookings
        if (Date.now() - startTime >= CLEANUP_LOOP_BUDGET_MS) {
          break;
        }

        totalProcessed++;

        try {
          // PostgREST embeds a single object while payments.booking_id is UNIQUE (pre-20261102), an array after
          const payments = ([] as typeof booking.payments).concat(booking.payments ?? []);
          const result = await cleanupExpiredBooking({ ...booking, payments }, { supabase, reconciledSessions });
          if (result === "cancelled") cancelledCount++;
          else skippedIds.push(booking.id);
          if (result === "reconciled") reconciledCount++;
        } catch (bookingErr: unknown) {
          console.error(`Error processing booking ${booking.id}:`, bookingErr);
          skippedIds.push(booking.id);
        }
      }

      // If batch returned fewer items than BATCH_SIZE, the queue is drained
      if (expiredBookings.length < BATCH_SIZE) {
        break;
      }
    }

    // Process queued pending refunds from ledger within remaining time budget
    let refundResult = { processed: 0, succeeded: 0, failed: 0 };
    if (Date.now() - startTime < TOTAL_BUDGET_MS) {
      refundResult = await processPendingRefundJobs({
        workerId: "cron-cleanup-worker",
        leaseSeconds: 60,
        maxJobs: 10,
        supabase,
      }).catch((err: unknown) => {
        console.error("Refund worker execution in cron failed:", err);
        return { processed: 0, succeeded: 0, failed: 0 };
      });
    }

    // Auth rate-limit windows are at most an hour; drop counters older than a day so the table stays small
    const { error: limiterCleanupError } = await supabase
      .from("auth_rate_limits")
      .delete()
      .lt("window_start", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (limiterCleanupError) console.error("Rate limiter cleanup failed:", limiterCleanupError);

    return NextResponse.json({
      success: true,
      message: `Cleanup completed. Cancelled: ${cancelledCount}, Reconciled: ${reconciledCount}, Total examined: ${totalProcessed}, Refunds processed: ${refundResult.processed}.`,
      cancelledCount,
      reconciledCount,
      totalProcessed,
      refunds: refundResult,
    });
  } catch (error: unknown) {
    console.error("Cron job error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
