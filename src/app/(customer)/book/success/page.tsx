"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Calendar, Clock, MapPin, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <div className="flex flex-col min-h-screen bg-background items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <p className="mt-4 text-muted-foreground">Verifying your payment...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border rounded-2xl shadow-sm p-8 text-center space-y-6">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="size-10" />
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">Booking Confirmed!</h1>
            <p className="text-muted-foreground">
              {sessionId
                ? "Your court has been successfully reserved and paid for. We've sent the details to your email."
                : "Your court has been successfully reserved."}
            </p>
          </div>

          <div className="pt-6 border-t flex flex-col gap-3">
            <Link href="/my-bookings" className="w-full">
              <Button className="w-full">View My Bookings</Button>
            </Link>
            <Link href="/book" className="w-full">
              <Button variant="outline" className="w-full">Book Another Court</Button>
            </Link>
            <Link href="/" className="w-full">
              <Button variant="ghost" className="w-full gap-2">
                <ArrowLeft className="size-4" />
                Return to Home
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    }>
      <BookingSuccessContent />
    </Suspense>
  );
}
