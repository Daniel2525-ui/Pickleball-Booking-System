import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { VENUE_CITY, VENUE_NAME, brandInitials } from "@/lib/brand";

// Two-tone wordmark: the last word of the name in the accent colour

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-8 sm:py-12 bg-background selection:bg-primary/20 selection:text-primary">
      {/* Phones: in the flow, card-wide, so it never sits on the logo and lines up with the card edge.
          Wider screens have room for it in the corner. */}
      <div className="w-full max-w-sm mb-4 pt-[env(safe-area-inset-top)] sm:pt-0 sm:mb-0 sm:w-auto sm:absolute sm:top-8 sm:left-8">
        <Link
          href="/"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 gap-2 min-h-[44px] px-3 text-muted-foreground hover:text-foreground" })}
        >
          <ArrowLeft className="size-4" />
          Back to courts
        </Link>
      </div>

      {/* Brand Identity */}
      <Link href="/" className="flex items-center gap-2.5 mb-8 group">
        <span className="size-10 shrink-0 rounded-xl bg-primary text-primary-foreground grid place-items-center font-display font-bold">
          {brandInitials(VENUE_NAME)}
        </span>
        <div className="flex flex-col">
          <span className="font-display font-bold text-xl leading-none text-foreground">
            {VENUE_NAME}
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-0.5">
            {VENUE_CITY}
          </span>
        </div>
      </Link>

      {children}

      <p className="mt-2 text-[11px] text-muted-foreground/70">
        &copy; {new Date().getFullYear()} {VENUE_NAME}. All rights reserved.
      </p>
    </div>
  );
}
