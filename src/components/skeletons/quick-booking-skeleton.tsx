import { Skeleton } from "@/components/ui/skeleton";
import { Step } from "@/components/customers/quick-booking";

const Card = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border bg-card p-4 flex flex-col gap-3 min-w-0">
    <h3 className="text-base font-extrabold flex items-center gap-2.5"><Step n={n} />{title}</h3>
    {children}
  </div>
);

const Options = () => (
  <div className="grid grid-cols-2 gap-2">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-14 rounded-xl" />
    ))}
  </div>
);

/** Mirrors QuickBooking's four steps so the page doesn't jump when data lands. */
export function QuickBookingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading booking options" className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 items-start">
      <div className="flex flex-col gap-4 min-w-0">
        <Card n={1} title="Which day?">
          <div className="flex gap-1.5 overflow-hidden pb-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="shrink-0 w-[56px] h-[58px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-5 w-48" />
        </Card>
        <Card n={2} title="How many courts?">
          <Options />
        </Card>
        <Card n={3} title="How long?">
          <Options />
        </Card>
      </div>

      <Card n={4} title="Pick a start time">
        {Array.from({ length: 3 }).map((_, p) => (
          <div key={p} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
