import type { ReportSeriesRow } from "@/lib/services/reports/reports";

export const peso = (n: number) => `₱${Math.round(Number(n) || 0).toLocaleString("en-PH")}`;

/** "Sep 10" for a day bucket, "Sep 2026" for a month bucket. */
export function bucketLabel(key: string, bucket: "day" | "month") {
  const date = new Date(`${bucket === "day" ? key : `${key}-01`}T12:00:00+08:00`);
  return date.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", ...(bucket === "day" ? { day: "numeric" } : { year: "numeric" }) });
}

/** Net money per day (or month): one series, so no legend; hover or focus a bar for its value. */
export function RevenueChart({ series, bucket }: { series: ReportSeriesRow[]; bucket: "day" | "month" }) {
  const max = Math.max(0, ...series.map((r) => r.net));
  if (max === 0) {
    return <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">No money came in during this period.</p>;
  }
  const ticks = [0, Math.floor((series.length - 1) / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div>
      <div className="mt-4 flex h-40 items-end gap-0.5 border-b border-border">
        {series.map((r) => {
          const label = `${bucketLabel(r.key, bucket)}: ${peso(r.net)}`;
          return (
            <div
              key={r.key}
              role="img"
              aria-label={label}
              title={label}
              tabIndex={0}
              className="flex-1 rounded-t-[4px] bg-primary/85 outline-none hover:bg-primary focus-visible:bg-primary focus-visible:ring-2 focus-visible:ring-ring"
              style={{ height: r.net > 0 ? `${(r.net / max) * 100}%` : "2px", opacity: r.net > 0 ? undefined : 0.3 }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        {ticks.map((i) => <span key={i}>{bucketLabel(series[i].key, bucket)}</span>)}
      </div>
    </div>
  );
}
