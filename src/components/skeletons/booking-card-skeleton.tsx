import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock } from "lucide-react";

export function BookingCardSkeleton() {
  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center p-5 rounded-2xl border bg-card shadow-sm">
      <div className="space-y-3 w-full sm:w-auto">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm mt-3">
          <div className="flex items-center gap-1.5">
            <Calendar className="size-4 text-muted-foreground/50" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="size-4 text-muted-foreground/50" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start sm:items-end w-full sm:w-auto mt-2 sm:mt-0">
        <Skeleton className="h-3 w-20 mb-2" />
        <Skeleton className="h-7 w-24" />
      </div>
    </div>
  );
}
