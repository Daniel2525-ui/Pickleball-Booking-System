import Link from "next/link";
import { VENUE_CITY, VENUE_NAME, brandInitials } from "@/lib/brand";

export function PublicFooter() {
  return (
    <footer id="contact" className="border-t bg-card py-10 text-sm text-muted-foreground">
      <div className="container mx-auto px-4 max-w-6xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <span className="size-9 shrink-0 rounded-[10px] bg-primary text-primary-foreground grid place-items-center font-display font-bold text-sm">
            {brandInitials(VENUE_NAME)}
          </span>
          <div>
            <p className="font-display font-bold text-foreground">{VENUE_NAME}</p>
            <p className="text-xs">{VENUE_CITY}&apos;s pickleball courts</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <Link href="/#faq" className="hover:text-foreground transition-colors">FAQ</Link>
          <Link href="/terms#cancellation" className="hover:text-foreground transition-colors">Cancellation policy</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <span>&copy; {new Date().getFullYear()} {VENUE_NAME}</span>
        </div>
      </div>
    </footer>
  );
}
