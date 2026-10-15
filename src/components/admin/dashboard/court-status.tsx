"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircleCheck, Clock, Layers, Wrench, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchCourtStatus } from "@/lib/services/dashboard/courtStatus.service";
import { useEffect, useState } from "react";

type CourtStatusType = "Available" | "In Use" | "Maintenance" | "Closed";
interface Court {
  name: string;
  status: CourtStatusType;
}

export default function CourtStatus({ className }: { className?: string }) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);

  const statusConfig: Record<
    CourtStatusType,
    {
      label: string;
      icon: typeof CircleCheck;
      dotColor: string;
      badgeStyle: string;
    }
  > = {
    Available: {
      label: "Available",
      icon: CircleCheck,
      dotColor: "bg-emerald-500",
      badgeStyle: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
    },
    "In Use": {
      label: "In Play",
      icon: Clock,
      dotColor: "bg-amber-500",
      badgeStyle: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20",
    },
    Maintenance: {
      label: "Maintenance",
      icon: Wrench,
      dotColor: "bg-orange-500",
      badgeStyle: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/20",
    },
    Closed: {
      label: "Closed",
      icon: XCircle,
      dotColor: "bg-zinc-500",
      badgeStyle: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border border-zinc-500/20",
    },
  };

  useEffect(() => {
    const loadCourtStatus = async () => {
      setLoading(true);
      const { data } = await fetchCourtStatus();

      if (data) {
        setCourts(data.courts);
      }

      setLoading(false);
    };

    loadCourtStatus();
  }, []);

  return (
    <Card className={`border border-border shadow-2xs ${className || ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-foreground">
            Live Court Occupancy
          </CardTitle>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border p-3">
                <Skeleton className="size-8 rounded-lg shrink-0" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-20 mb-1.5" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : courts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <Layers className="size-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">No courts found</p>
            <p className="text-xs text-muted-foreground">Add courts in the Courts &amp; Rates section.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {courts.map((court) => {
              const config = statusConfig[court.status] || statusConfig.Available;
              const Icon = config.icon;

              return (
                <div
                  key={court.name}
                  className="flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3 shadow-2xs hover:border-primary/30 transition-colors"
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${config.badgeStyle}`}
                  >
                    <Icon className="size-4" />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-tight text-foreground truncate">
                      {court.name}
                    </p>

                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`inline-block size-1.5 rounded-full ${config.dotColor}`} />
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {config.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
