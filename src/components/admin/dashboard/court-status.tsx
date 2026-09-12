"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircleCheck, Clock, LoaderCircle } from "lucide-react";
import { fetchCourtStatus } from "@/lib/services/dashboard.service";
import { useEffect, useState } from "react";

type CourtStatusType = "Available" | "In Use";
interface Court {
  name: string;
  status: CourtStatusType;
}

export default function CourtStatus({ className }: { className?: string }) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true)

  const statusConfig: Record<
    CourtStatusType,
    {
      icon: typeof CircleCheck;
      dotColor: string
    }
  > = {
    Available: {
      icon: CircleCheck,
      dotColor: "bg-emerald-500",
    },
    "In Use": {
      icon: Clock,
      dotColor: "bg-amber-500"
    }
  }

  useEffect(() => {
    const loadCourtStatus = async () => {

      setLoading(true)

      const { data } = await fetchCourtStatus();

      if (data) {
        setCourts(data.courts);
      }

      setLoading(false)
    };

    loadCourtStatus();
  }, []);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Court Status
        </CardTitle>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <LoaderCircle className="size-4 animate-spin" />
            <span className="text-sm text-muted-foreground">
              Fetching Court Status...
            </span>
          </div>
        ) : courts.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <span className="text-sm text-muted-foreground">
              No courts added yet.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {courts.map((court) => {
              const config = statusConfig[court.status];
              const Icon = config.icon;

              return (
                <div
                  key={court.name}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-md ${court.status === "Available"
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-amber-50 text-amber-600"
                      }`}
                  >
                    <Icon className="size-4" />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none">
                      {court.name}
                    </p>

                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span
                        className={`inline-block size-1.5 rounded-full ${config.dotColor}`}
                      />

                      <span className="text-xs text-muted-foreground">
                        {court.status}
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
