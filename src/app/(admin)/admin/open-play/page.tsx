import { Metadata } from "next"
import { OpenPlayContainer } from "@/components/admin/open-play/open-play-container"
import { VENUE_NAME } from "@/lib/brand";
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = {
  title: "Open Play | Admin",
  description: `Run weekly open play sessions, see who booked, and add walk-ups for ${VENUE_NAME}.`,
}

export default function OpenPlayPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <AdminPageHeader title="Open play" description="Weekly sessions players join by the spot, and who is coming." />

      <OpenPlayContainer />
    </div>
  )
}
