import { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DiscountsContainer } from "@/components/admin/discounts/discounts-container";

export const metadata: Metadata = {
  title: "Discount codes | Admin",
};

export default function DiscountsPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <AdminPageHeader title="Discount codes" description="Codes players type at checkout, how much they take off, and when they work." />
      <DiscountsContainer />
    </div>
  );
}
