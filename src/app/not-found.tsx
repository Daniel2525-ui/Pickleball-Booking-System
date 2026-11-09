import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PublicHeader } from "@/components/customers/public-header";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <PublicHeader />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="font-display text-7xl font-black text-primary">404</p>
        <h1 className="text-2xl font-extrabold">This page isn&apos;t on the court</h1>
        <p className="max-w-sm text-sm text-muted-foreground">The link may be old or mistyped. Head back and pick a court from the booking grid.</p>
        <Link href="/" className={buttonVariants({ className: "mt-2 min-h-[44px] px-6 font-bold" })}>
          Back to courts
        </Link>
      </main>
    </div>
  );
}
