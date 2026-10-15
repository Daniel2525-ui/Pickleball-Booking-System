import { Metadata } from "next";
import { CreditCard } from "lucide-react";
import PaymentsContainer from "@/components/admin/payments/payments-container";

export const metadata: Metadata = {
  title: "Payments & Transactions | Admin",
  description: "View and audit customer payment transactions, Stripe checkout records, and booking revenue for Crosshair Dinkers.",
};

export default function PaymentsPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 pb-4 sm:pt-7 sm:pb-4 border-b border-border/60 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments & Transactions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Audit player payments, monitor online checkout status, and review transaction history across all courts.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground border border-border shrink-0 self-start sm:self-auto">
          <CreditCard className="h-3.5 w-3.5 text-primary" />
          <span>Gateway: Stripe & Walk-in Records</span>
        </div>
      </header>

      <PaymentsContainer />
    </div>
  );
}

