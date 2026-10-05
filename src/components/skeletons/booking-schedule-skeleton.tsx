import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function BookingScheduleSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Date Selector Skeleton */}
      <div className="lg:col-span-4 xl:col-span-3">
        <div className="mb-8 bg-card border rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b bg-muted/30">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CalendarIcon className="size-5 text-muted-foreground" />
              <Skeleton className="h-6 w-28" />
            </h2>
          </div>
          <div className="p-4 md:p-6">
            <div className="flex flex-col gap-6">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-4">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
                {/* Days of week */}
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="py-2 flex justify-center">
                      <Skeleton className="h-4 w-6" />
                    </div>
                  ))}
                </div>
                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square w-full rounded-xl" />
                  ))}
                </div>
              </div>
              <div className="w-full">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-7 w-48 mb-3" />
                  <Skeleton className="h-5 w-36" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Skeleton */}
      <div className="lg:col-span-8 xl:col-span-9">
        <div className="bg-card border rounded-2xl shadow-sm overflow-hidden flex-1">
          <div className="p-4 border-b bg-muted/30">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="size-5 text-muted-foreground" />
              <Skeleton className="h-6 w-36" />
            </h2>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[600px] md:min-w-[800px]">
              {/* Grid Header */}
              <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] border-b">
                <div className="p-4 border-r sticky left-0 z-20 bg-background flex items-center justify-center">
                  <Skeleton className="h-5 w-12" />
                </div>
                <div className="grid grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 border-l flex justify-center">
                      <Skeleton className="h-5 w-20" />
                    </div>
                  ))}
                </div>
              </div>
              {/* Grid Body */}
              <div className="divide-y">
                {Array.from({ length: 8 }).map((_, rIdx) => (
                  <div key={rIdx} className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr]">
                    <div className="p-2 border-r sticky left-0 z-10 bg-background flex items-center justify-center">
                      <Skeleton className="h-5 w-16" />
                    </div>
                    <div className="grid grid-cols-4">
                      {Array.from({ length: 4 }).map((_, cIdx) => (
                        <div key={cIdx} className="p-2 border-l">
                          <Skeleton className="w-full h-[48px] rounded-lg" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
