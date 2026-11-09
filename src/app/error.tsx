"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";

/** Any page that crashes below the root layout. The reference lets a player quote the logged error to staff. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-extrabold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Try again, and if it keeps happening, contact the front desk. If you were paying, check My bookings before paying again.
      </p>
      {digest && <p className="font-mono text-xs text-muted-foreground">Reference: {digest}</p>}
      <div className="mt-2 flex gap-3">
        <Button onClick={() => retry()} className="min-h-[44px] px-6 font-bold">Try again</Button>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "min-h-[44px] px-6" })}>Home</Link>
      </div>
    </main>
  );
}
