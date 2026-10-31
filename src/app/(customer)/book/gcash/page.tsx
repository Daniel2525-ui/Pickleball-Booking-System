import { PublicHeader } from "@/components/customers/public-header";
import { GcashPaymentContainer } from "@/components/customers/gcash-payment-container";

export default async function GcashPaymentPage({ searchParams }: { searchParams: Promise<{ basket?: string }> }) {
  const { basket } = await searchParams;
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="flex-1 flex flex-col items-center p-4 py-8 sm:py-12">
        <GcashPaymentContainer basketId={basket ?? ""} />
      </main>
    </div>
  );
}
