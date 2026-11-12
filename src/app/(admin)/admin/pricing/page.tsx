import { Metadata } from "next"
import { PricingContainer } from "@/components/admin/pricing/pricing-container"
import { VENUE_NAME } from "@/lib/brand";
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = {
  title: "Pricing & Booking Rules | Admin",
  description: `Configure court rates, peak hours and booking length for ${VENUE_NAME}.`,
}

export default function PricingPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <AdminPageHeader title="Prices & booking rules" description="Hourly rates, peak windows and the shortest booking players can make." />

      <PricingContainer />
    </div>
  )
}
