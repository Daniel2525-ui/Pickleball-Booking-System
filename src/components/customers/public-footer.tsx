import Link from "next/link";
import { Phone } from "lucide-react";
import {
  VENUE_CITY,
  VENUE_NAME,
  VENUE_PHONE,
  VENUE_FACEBOOK_URL,
  VENUE_INSTAGRAM_URL,
  VENUE_TIKTOK_URL,
  brandInitials,
} from "@/lib/brand";

// lucide dropped brand icons, so these are drawn in its stroke style
const SOCIALS = [
  { label: "Facebook", href: VENUE_FACEBOOK_URL, icon: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /> },
  {
    label: "Instagram",
    href: VENUE_INSTAGRAM_URL,
    icon: (
      <>
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <path d="M17.5 6.5h.01" />
      </>
    ),
  },
  { label: "TikTok", href: VENUE_TIKTOK_URL, icon: <path d="M9 12a4 4 0 1 0 4 4V2a5 5 0 0 0 5 5" /> },
].filter((s) => s.href);

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
        {(VENUE_PHONE || SOCIALS.length > 0) && (
          <div className="flex items-center gap-4">
            {VENUE_PHONE && (
              <a href={`tel:${VENUE_PHONE.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Phone className="size-4" aria-hidden />
                {VENUE_PHONE}
              </a>
            )}
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${VENUE_NAME} on ${s.label}`}
                className="grid place-items-center size-9 rounded-full border hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {s.icon}
                </svg>
              </a>
            ))}
          </div>
        )}
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
