import { Metadata } from "next";
import { Suspense } from "react";
import PaymentsContainer from "@/components/admin/payments/payments-container";
import { VENUE_NAME } from "@/lib/brand";
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = {
  title: "Payments | Admin",
  description: `QR Ph and desk payments, refunds and the daily close-out for ${VENUE_NAME}.`,
};

export default function PaymentsPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <AdminPageHeader title="Payments" description="Today's close-out: money taken by QR Ph and at the desk, refunds owed, and every payment." />

      <Suspense>
        <PaymentsContainer />
      </Suspense>
    </div>
  );
}

