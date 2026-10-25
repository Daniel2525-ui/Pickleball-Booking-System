import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client with service role to bypass RLS
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRole);

export async function GET(request: Request) {
  try {
    // Security check to ensure this is called with valid Vercel Cron secret
    const authHeader = request.headers.get("authorization");
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Calculate cutoff time: 30 minutes ago (aligns with Stripe Checkout session expiry)
    const cutoffTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    // Find all pending bookings created before the cutoff time
    const { data: pendingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select(`
        id,
        created_at,
        payments(
          id,
          status,
          stripe_session_id
        )
      `)
      .eq("status", "pending")
      .lt("created_at", cutoffTime);

    if (fetchError) {
      console.error("Error fetching pending bookings:", fetchError);
      return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
    }

    if (!pendingBookings || pendingBookings.length === 0) {
      return NextResponse.json({ message: "No expired pending bookings found." });
    }

    let cancelledCount = 0;

    for (const booking of pendingBookings) {
      const payments = booking.payments || [];

      // If any associated payment was marked paid, do not cancel this booking
      const hasPaidPayment = payments.some((p: { status?: string }) => p.status === "paid");
      if (hasPaidPayment) {
        continue;
      }

      for (const payment of payments) {
        if (payment.stripe_session_id) {
          try {
            await stripe.checkout.sessions.expire(payment.stripe_session_id);
          } catch (stripeError: unknown) {
            console.error(`Failed to expire Stripe session ${payment.stripe_session_id}:`, (stripeError as Error).message);
          }
        }

        // Only mark pending payment as cancelled
        if (payment.status === "pending") {
          await supabase
            .from("payments")
            .update({ status: "cancelled" })
            .eq("id", payment.id)
            .eq("status", "pending");
        }
      }

      // Mark booking as cancelled
      await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id)
        .eq("status", "pending");
        
      cancelledCount++;
    }

    return NextResponse.json({ 
      success: true, 
      message: `Successfully cancelled ${cancelledCount} expired booking(s).` 
    });

  } catch (error: unknown) {
    console.error("Cron job error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
