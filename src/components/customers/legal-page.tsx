import { PublicHeader } from "@/components/customers/public-header";
import { VENUE_NAME } from "@/lib/brand";

/** Shared shell for the Privacy Policy and Terms pages. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <PublicHeader />
      <main className="flex-1 py-10 sm:py-14">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-foreground [&_h2]:pt-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-foreground">
          {/* shortcut: draft text written from the app's behaviour, replace with client-approved copy before launch */}
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
            Draft for review by {VENUE_NAME} management. This page is not yet final.
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{title}</h1>
          {children}
        </article>
      </main>
    </div>
  );
}
