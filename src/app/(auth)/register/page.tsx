import { ArrowLeft, Crosshair, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-background selection:bg-primary/20 selection:text-primary">
      {/* Back to Home Button */}
      <Link href="/" className="absolute top-4 left-4 sm:top-8 sm:left-8">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground text-xs sm:text-sm font-medium"
        >
          <ArrowLeft className="size-4" />
          Back to Courts
        </Button>
      </Link>

      {/* Brand Identity */}
      <Link href="/" className="flex items-center gap-2.5 mb-8 group">
        <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-xs group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200">
          <Crosshair className="size-5 transition-transform group-hover:rotate-45" />
        </div>
        <div className="flex flex-col">
          <span className="font-extrabold text-xl tracking-tight leading-none text-foreground">
            Crosshair Dinkers
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-0.5">
            Butuan City
          </span>
        </div>
      </Link>

      <RegisterForm />

      {/* Trust & Local Venue Note */}
      <div className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Shield className="size-3.5 text-primary" />
        <span>By signing up, you agree to our venue guidelines &amp; booking rules</span>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground/70">
        &copy; {new Date().getFullYear()} Crosshair Dinkers. All rights reserved.
      </p>
    </div>
  );
}
