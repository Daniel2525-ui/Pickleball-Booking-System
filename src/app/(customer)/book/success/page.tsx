"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  CalendarDays,
  MapPin,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  Sparkles,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicHeader } from "@/components/customers/public-header";

function BookingSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    async function verifySession() {
      if (!sessionId) {
        setIsVerifying(false);
        return;
      }
      try {
        await fetch("/api/stripe/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      } catch (err) {
        console.error("Verification failed", err);
      } finally {
        setIsVerifying(false);
      }
    }
    verifySession();
  }, [sessionId]);

  if (isVerifying) {
    return (
      <div className="flex flex-col min-h-screen bg-background text-foreground">
        <PublicHeader />
        <main className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="flex flex-col items-center max-w-sm text-center">
            <div className="size-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4">
              <Loader2 className="size-7 animate-spin" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Confirming Your Reservation
            </h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Verifying your payment with Stripe and securing your court slot at Crosshair Dinkers...
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-primary/20 selection:text-primary">
      <PublicHeader />

      <main className="flex-1 flex flex-col items-center justify-center p-4 py-12 sm:py-16">
        <div className="max-w-lg w-full bg-card border border-border rounded-2xl shadow-md p-6 sm:p-8 space-y-6">
          {/* Success Status Emblem */}
          <div className="flex flex-col items-center text-center">
            <div className="size-16 sm:size-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4 shadow-xs">
              <CheckCircle2 className="size-8 sm:size-10" />
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-2">
              <ShieldCheck className="size-3.5" />
              <span>Confirmed &amp; Paid</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Court Reserved Successfully!
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-2 leading-relaxed">
              {sessionId
                ? "Your court reservation is locked in and paid. We've sent a receipt to your email and added your digital pass to My Bookings."
                : "Your court reservation has been successfully confirmed."}
            </p>
          </div>

          {/* Match Day Expectations Card */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5 space-y-3.5 text-xs sm:text-sm">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <Info className="size-4 text-primary shrink-0" />
              <span>Match Day Reminders</span>
            </div>

            <div className="space-y-2 text-muted-foreground leading-relaxed">
              <div className="flex items-start gap-2.5">
                <MapPin className="size-4 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong>Venue:</strong> Crosshair Dinkers Complex, J.C. Aquino Ave, Butuan City.
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <Sparkles className="size-4 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong>Footwear:</strong> Non-marking athletic court shoes are required on all tournament courts.
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <CalendarDays className="size-4 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong>Check-in:</strong> Please check in at reception 10 minutes prior to your slot.
                </span>
              </div>
            </div>
          </div>

          {/* Primary & Secondary Actions */}
          <div className="pt-2 flex flex-col gap-2.5">
            <Link href="/my-bookings" className="w-full">
              <Button className="w-full h-11 font-bold text-sm shadow-sm hover:shadow transition-all gap-2">
                <CalendarDays className="size-4" />
                View My Match Pass
              </Button>
            </Link>

            <Link href="/#booking" className="w-full">
              <Button variant="outline" className="w-full h-11 font-semibold text-sm">
                Reserve Another Court
              </Button>
            </Link>

            <Link href="/" className="w-full">
              <Button variant="ghost" className="w-full h-11 text-xs font-semibold text-muted-foreground hover:text-foreground gap-1.5">
                <ArrowLeft className="size-3.5" />
                Back to Home
              </Button>
            </Link>
          </div>

          {/* Support Helpline */}
          <p className="text-center text-[11px] text-muted-foreground pt-2 border-t">
            Questions about your booking? Call venue reception at{" "}
            <span className="font-semibold text-foreground">+63 917 123 4567</span>.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      }
    >
      <BookingSuccessContent />
    </Suspense>
  );
}
