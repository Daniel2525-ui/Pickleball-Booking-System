import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { processStripePaymentReconciliation } from "@/lib/services/payments/processStripePaymentReconciliation";
import { processPendingRefundJobs } from "@/lib/services/payments/refundWorker.ts";

/**
 * Cleanup cron job for expired reservation holds.
 *
 * Concurrency Safety:
 * 1. Checks external Stripe session state before performing cancellation.
 * 2. If Stripe session is paid or complete, reconciles via processStripePaymentReconciliation
 *    instead of cancelling.
 * 3. If Stripe session is open, expires the Stripe session to prevent late checkout.
 * 4. Calls cancel_expired_booking RPC, which uses database-level FOR UPDATE locks and
 *    conditional checks (hold_expires_at <= now() and status == 'pending') to prevent
 *    races with concurrent webhook deliveries.
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
    const nowIso = new Date().toISOString();
    const fallbackCutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString();

    // Query pending bookings where hold has expired
    const { data: expiredBookings, error: fetchError } = await supabase
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
          currency
        )
      `)
      .eq("status", "pending")
      .or(`hold_expires_at.lte.${nowIso},and(hold_expires_at.is.null,created_at.lt.${fallbackCutoff})`)
      .limit(25);

    if (fetchError) {
      console.error("Error fetching expired bookings:", fetchError);
      return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
    }

    let reconciledCount = 0;
    let cancelledCount = 0;

    if (expiredBookings && expiredBookings.length > 0) {
      for (const booking of expiredBookings) {
        const payments = booking.payments || [];

        for (const payment of payments) {
          if (payment.status !== "pending") {
            continue;
          }

          // Check Stripe Checkout session state if available
          if (payment.stripe_session_id) {
            try {
              const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);

              // Reconcile paid sessions instead of cancelling
              if (session.payment_status === "paid" || session.status === "complete") {
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
                    continue;
                  }
                }
              } else if (session.status === "open") {
                // Expire session to prevent user from paying after hold expiration
                try {
                  await stripe.checkout.sessions.expire(session.id);
                } catch (expireErr: unknown) {
                  console.error(`Failed to expire Stripe session ${session.id}:`, (expireErr as Error).message);
                }
              }
            } catch (stripeErr: unknown) {
              console.error(`Error checking Stripe session for payment ${payment.id}:`, (stripeErr as Error).message);
            }
          }

          // Database-side conditional cancellation under FOR UPDATE lock
          const { data: cancelResult, error: cancelErr } = await supabase.rpc("cancel_expired_booking", {
            p_booking_id: booking.id,
            p_payment_id: payment.id,
          });

          if (cancelErr) {
            console.error(`cancel_expired_booking RPC failed for ${booking.id}:`, cancelErr);
          } else if (cancelResult?.cancelled) {
            cancelledCount++;
          }
        }
      }
    }

    // Process queued pending refunds from ledger
    const refundResult = await processPendingRefundJobs({
      workerId: "cron-cleanup-worker",
      leaseSeconds: 60,
      maxJobs: 10,
      supabase,
    }).catch((err: unknown) => {
      console.error("Refund worker execution in cron failed:", err);
      return { processed: 0, succeeded: 0, failed: 0 };
    });

    return NextResponse.json({
      success: true,
      message: `Cleanup completed. Cancelled: ${cancelledCount}, Reconciled: ${reconciledCount}, Refunds processed: ${refundResult.processed}.`,
      cancelledCount,
      reconciledCount,
      refunds: refundResult,
    });
  } catch (error: unknown) {
    console.error("Cron job error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
