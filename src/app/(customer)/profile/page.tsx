import { Metadata } from "next";
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
        <ProfileForm />
      </main>
    </div>
  );
}
