export interface BreakdownItem {
  label: string;
  /** Bar length relative to `max`; null draws no bar */
  value: number | null;
  /** The figure shown at the end of the row */
  display: string;
  muted?: boolean;
}

/** Labelled horizontal bars: the label and figure carry the meaning, the bar only shows proportion. */
export function BreakdownBars({ items, max }: { items: BreakdownItem[]; max: number }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.label} role="group" aria-label={item.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate">{item.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {item.value !== null && max > 0 && (
              <div
                className={`h-full rounded-full ${item.muted ? "bg-muted-foreground/50" : "bg-primary"}`}
                style={{ width: `${Math.min(100, (item.value / max) * 100)}%` }}
              />
            )}
          </div>
          <span className="text-right font-semibold tabular-nums">{item.display}</span>
        </div>
      ))}
    </div>
  );
}
