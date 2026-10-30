import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PublicHeader } from "@/components/customers/public-header";
import { ProfileForm } from "@/components/customers/profile-form";

export const metadata: Metadata = {
  title: "My Profile | Crosshair Dinkers",
};

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <PublicHeader />
      <main className="flex-1 py-10 sm:py-14 px-4">
        {/* Phones hide the header's Book link, so give them a way back */}
        <div className="max-w-md mx-auto mb-2 sm:hidden">
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 gap-2 min-h-[44px] px-3 text-muted-foreground hover:text-foreground" })}>
            <ArrowLeft className="size-4" />
            Back to courts
          </Link>
        </div>
        <ProfileForm />
      </main>
    </div>
  );
}
