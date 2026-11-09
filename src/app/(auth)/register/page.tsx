import { Shield } from "lucide-react";
import { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create Account",
};

export default function RegisterPage() {
  return (
    <>
      <RegisterForm />

      {/* Trust & Local Venue Note */}
      <div className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Shield className="size-3.5 text-primary" />
        <span>
          By signing up, you agree to our{" "}
          <Link href="/terms" className="font-semibold text-foreground hover:underline underline-offset-4">Booking Rules</Link> and{" "}
          <Link href="/privacy" className="font-semibold text-foreground hover:underline underline-offset-4">Privacy Policy</Link>
        </span>
      </div>
    </>
  );
}
