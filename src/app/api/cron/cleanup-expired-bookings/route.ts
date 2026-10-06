import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client with service role to bypass RLS
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRole);

export async function GET(request: Request) {
  try {
    // Basic security check to ensure this is called by Vercel Cron
    const authHeader = request.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Calculate cutoff time: 15 minutes ago
    const cutoffTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // Find all pending bookings created before the cutoff time
    const { data: pendingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select(`
        id,
        created_at,
        payments!inner(
          id,
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
      // payments is an array if one-to-many, but in this schema it might be an array or object.
      // Let's assume it's an array based on standard Supabase joins
      const payments = Array.isArray(booking.payments) ? booking.payments : [booking.payments];
      
      for (const payment of payments) {
        if (payment.stripe_session_id) {
          try {
            // Expire the checkout session in Stripe so they can't pay it anymore
            await stripe.checkout.sessions.expire(payment.stripe_session_id);
          } catch (stripeError: any) {
            // If the session is already expired or completed, Stripe might throw an error. 
            // We log it and continue since we still want to clean up our DB if it's pending.
            console.error(`Failed to expire Stripe session ${payment.stripe_session_id}:`, stripeError.message);
          }
        }

        // Mark payment as cancelled
        await supabase
          .from("payments")
          .update({ status: "cancelled" })
          .eq("id", payment.id);
      }

      // Mark booking as cancelled
      await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id);
        
      cancelledCount++;
    }

    return NextResponse.json({ 
      success: true, 
      message: `Successfully cancelled ${cancelledCount} expired booking(s).` 
    });

  } catch (error: any) {
    console.error("Cron job error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
