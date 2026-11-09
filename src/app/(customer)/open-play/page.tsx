import { PublicHeader } from "@/components/customers/public-header";
import { OpenPlayContainer } from "@/components/customers/open-play-container";
import { Metadata } from "next";
import { VENUE_NAME, VENUE_CITY } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Open Play",
  description: `Book a spot in an upcoming open play session at ${VENUE_NAME} ${VENUE_CITY}.`,
};

export default function OpenPlayPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <PublicHeader />
      <main className="flex-1 py-8 sm:py-12">
        <OpenPlayContainer />
      </main>
    </div>
  );
}
