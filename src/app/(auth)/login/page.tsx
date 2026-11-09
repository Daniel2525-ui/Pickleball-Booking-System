import { Suspense } from "react";
import { Loader2, Shield } from "lucide-react";
import { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { VENUE_NAME, VENUE_CITY } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Sign In",
};

export default function LoginPage() {
  return (
    <>
      <Suspense
        fallback={
          <div className="w-full max-w-sm h-80 flex items-center justify-center border rounded-xl bg-card">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>

      {/* Trust & Local Venue Note */}
      <div className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Shield className="size-3.5 text-primary" />
        <span>Secure authentication for {VENUE_NAME} {VENUE_CITY}</span>
      </div>
    </>
  );
}
