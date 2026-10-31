import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PublicHeader } from "@/components/customers/public-header";
import { GcashPaymentContainer } from "@/components/customers/gcash-payment-container";

export default async function GcashPaymentPage({ searchParams }: { searchParams: Promise<{ basket?: string }> }) {
  const { basket } = await searchParams;
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="flex-1 flex flex-col items-center p-4 py-8 sm:py-12">
        <div className="max-w-lg w-full mb-2">
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 gap-2 min-h-[44px] px-3 text-muted-foreground hover:text-foreground" })}>
            <ArrowLeft className="size-4" />
            Back to courts
          </Link>
        </div>
        <GcashPaymentContainer basketId={basket ?? ""} />
      </main>
    </div>
  );
}
