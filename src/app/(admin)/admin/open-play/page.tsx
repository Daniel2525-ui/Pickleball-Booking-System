import { Metadata } from "next"
import { UsersRound } from "lucide-react"
import { OpenPlayContainer } from "@/components/admin/open-play/open-play-container"
import { VENUE_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Open Play | Admin",
  description: `Run weekly open play sessions, see who booked, and add walk-ups for ${VENUE_NAME}.`,
}

export default function OpenPlayPage() {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-6xl mx-auto">
      <header className="sticky top-14 z-20 bg-background/95 backdrop-blur-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 pb-4 sm:pt-7 sm:pb-4 border-b border-border/60 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Open Play</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly sessions where players book 1 to 4 spots. Sessions are made from the schedule below.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground border border-border shrink-0 self-start sm:self-auto">
          <UsersRound className="h-3.5 w-3.5 text-primary" />
          <span>Shows the next 28 days</span>
        </div>
      </header>

      <OpenPlayContainer />
    </div>
  )
}
