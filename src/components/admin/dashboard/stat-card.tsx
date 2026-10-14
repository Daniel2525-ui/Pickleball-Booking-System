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
      ? "text-emerald-600 dark:text-emerald-400 font-medium"
      : trendType === "negative"
      ? "text-destructive font-medium"
      : "text-muted-foreground";

  return (
    <Card className="shadow-2xs border border-border bg-card hover:border-primary/30 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary shrink-0">
            <Icon className="size-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
          {value}
        </p>
        <p className={`mt-1 text-xs leading-normal ${trendColor}`}>
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
