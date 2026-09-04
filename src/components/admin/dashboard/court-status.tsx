import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CircleCheck, Clock } from "lucide-react";

type CourtStatusType = "Available" | "In Use";

interface Court {
  name: string;
  status: CourtStatusType;
}

const courts: Court[] = [
  { name: "Court 1", status: "Available" },
  { name: "Court 2", status: "In Use" },
  { name: "Court 3", status: "Available" },
  { name: "Court 4", status: "Available" },
  { name: "Court 5", status: "In Use" },
  { name: "Court 6", status: "Available" },
];

const statusConfig: Record<
  CourtStatusType,
  {
    icon: typeof CircleCheck;
    variant: "outline" | "secondary";
    dotColor: string;
  }
> = {
  Available: {
    icon: CircleCheck,
    variant: "outline",
    dotColor: "bg-emerald-500",
  },
  "In Use": {
    icon: Clock,
    variant: "secondary",
    dotColor: "bg-amber-500",
  },
};

export default function CourtStatus({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Court Status</CardTitle>
      </CardHeader>
      <CardContent>
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
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                    court.status === "Available"
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
      </CardContent>
    </Card>
  );
}
