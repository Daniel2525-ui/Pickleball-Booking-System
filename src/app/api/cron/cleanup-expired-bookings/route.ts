import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { processStripePaymentReconciliation } from "@/lib/services/payments/processStripePaymentReconciliation";
import { processPendingRefundJobs } from "@/lib/services/payments/refundWorker.ts";

/**
 * Cleanup cron job for expired reservation holds.
 *
 * Concurrency & Safety Guarantees:
 * 1. Authenticates request via Authorization: Bearer <CRON_SECRET>.
 * 2. Processes in bounded batches (BATCH_SIZE = 25) with an execution time budget (MAX_EXECUTION_MS = 7500)
 *    to comfortably finish before Vercel serverless limits while draining backlogs across multiple iterations.
 * 3. Inspects Stripe Checkout sessions before performing database cancellation.
 * 4. If Stripe session is paid or complete, reconciles via processStripePaymentReconciliation
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
    const authHeader = request.headers.get("authorization");
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRole) {
      console.error("Cron configuration error: SUPABASE_SERVICE_ROLE_KEY is required to bypass RLS.");
      return NextResponse.json(
        { error: "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is missing." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRole);
    const BATCH_SIZE = 25;
    const TOTAL_BUDGET_MS = 8000;
    const CLEANUP_LOOP_BUDGET_MS = 6000;
    const startTime = Date.now();
    const skippedIds: string[] = [];

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

          // 1. Check if any DB payment record is already settled/paid
          const hasSettledPayment = payments.some(
            (p) => ["paid", "succeeded", "refunded"].includes(p.status?.toLowerCase()) || Boolean(p.paid_at)
          );

          if (hasSettledPayment) {
            console.warn(`Booking ${booking.id} has settled payment; skipping cancellation.`);
            skippedIds.push(booking.id);
            continue;
          }

          // 2. Inspect Stripe status for all payments associated with this booking
          let isStripeUncertain = false;
          let paidPaymentInfo: {
            payment: (typeof payments)[0];
            session: import("stripe").Stripe.Checkout.Session;
          } | null = null;
          const openSessionsToExpire: string[] = [];

          for (const payment of payments) {
            if (!payment.stripe_session_id) continue;

            try {
              const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);

              if (session.payment_status === "paid") {
                // Verified paid session
                if (!paidPaymentInfo) {
                  paidPaymentInfo = { payment, session };
                }
              } else if (session.status === "complete") {
                // Complete session but payment_status !== "paid" (e.g. async/delayed payment method).
                // Do not confirm as paid and do not cancel while payment may settle asynchronously.
                console.warn(
                  `Booking ${booking.id} has complete session ${session.id} with payment_status '${session.payment_status}'; treating as uncertain.`
                );
                isStripeUncertain = true;
              } else if (session.status === "open") {
                openSessionsToExpire.push(session.id);
              } else if (session.status === "expired") {
                // Safely expired unpaid session
              } else {
                console.warn(
                  `Booking ${booking.id} has session ${session.id} in unexpected status '${session.status}'; treating as uncertain.`
                );
                isStripeUncertain = true;
              }
            } catch (stripeErr: unknown) {
              console.error(
                `Uncertain Stripe state for payment ${payment.id} on booking ${booking.id}:`,
                (stripeErr as Error).message
              );
              isStripeUncertain = true;
              break;
            }
          }

          // Safety guard: if any Stripe session state is uncertain or delayed, never cancel
          if (isStripeUncertain) {
            skippedIds.push(booking.id);
            continue;
          }

          // If a session was paid, reconcile and expire any remaining open sessions
          if (paidPaymentInfo) {
            for (const openSessionId of openSessionsToExpire) {
              try {
                await stripe.checkout.sessions.expire(openSessionId);
              } catch (expireErr: unknown) {
                console.warn(`Could not expire redundant open session ${openSessionId}:`, (expireErr as Error).message);
              }
            }

            const { payment, session } = paidPaymentInfo;
            const paymentIntent = typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || "";

            if (paymentIntent) {
              const outcome = await processStripePaymentReconciliation({
                bookingId: booking.id,
                paymentId: payment.id,
                amount: (session.amount_total || 0) / 100,
                currency: (session.currency || "php").toLowerCase(),
                stripeSessionId: session.id,
                stripePaymentIntent: paymentIntent,
                supabase,
              });

              if (outcome.success) {
                reconciledCount++;
              } else {
                console.error(`Reconciliation failed for paid session ${session.id}:`, outcome.error);
              }
            } else {
              console.error(`Missing payment_intent for paid session ${session.id} on booking ${booking.id}`);
            }

            skippedIds.push(booking.id);
            continue;
          }

          // If no sessions were paid, expire all open sessions before cancelling
          let expireFailed = false;
          for (const openSessionId of openSessionsToExpire) {
            try {
              await stripe.checkout.sessions.expire(openSessionId);
            } catch (expireErr: unknown) {
              console.error(`Failed to expire Stripe session ${openSessionId}:`, (expireErr as Error).message);
              expireFailed = true;
              break;
            }
          }

          if (expireFailed) {
            skippedIds.push(booking.id);
            continue;
          }

          // 3. Find primary pending payment ID (if any)
          const pendingPayment = payments.find((p) => p.status === "pending");

          // 4. Cancel booking and mark pending payments failed under DB locks
          const { data: cancelResult, error: cancelErr } = await supabase.rpc("cancel_expired_booking", {
            p_booking_id: booking.id,
            p_payment_id: pendingPayment?.id ?? null,
          });

          if (cancelErr) {
            console.error(`cancel_expired_booking RPC failed for ${booking.id}:`, cancelErr);
            skippedIds.push(booking.id);
          } else if (cancelResult?.cancelled) {
            cancelledCount++;
          } else {
            console.log(`Booking ${booking.id} was not cancelled:`, cancelResult?.reason);
            skippedIds.push(booking.id);
          }
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
