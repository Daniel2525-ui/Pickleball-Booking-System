import { Skeleton } from "@/components/ui/skeleton";

/** A settings-style card while it loads: title, description, labelled inputs and a save button. */
export function FormCardSkeleton({ fields = 2, columns = 1, button = true }: { fields?: number; columns?: 1 | 3; button?: boolean }) {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm" aria-hidden="true">
      <div className="flex flex-col gap-2 p-6">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-4 px-6 pb-6">
        <div className={columns === 3 ? "grid gap-4 sm:grid-cols-3" : "flex max-w-md flex-col gap-4"}>
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        {button && <Skeleton className="h-9 w-40" />}
      </div>
    </div>
  );
}
