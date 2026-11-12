import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  trendType?: "positive" | "negative" | "neutral";
}

export default function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trendType = "neutral",
}: StatCardProps) {
  const trendColor =
    trendType === "positive"
      ? "text-primary font-semibold"
      : trendType === "negative"
      ? "text-destructive font-medium"
      : "text-muted-foreground";

  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="px-4 pt-4 pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
          <Icon className="size-4 text-primary shrink-0" aria-hidden />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="font-display text-3xl font-bold text-foreground tabular-nums">{value}</p>
        <p className={`mt-1 text-xs leading-normal ${trendColor}`}>{description}</p>
      </CardContent>
    </Card>
  );
}
