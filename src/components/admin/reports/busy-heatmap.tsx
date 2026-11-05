import type { VenueReport } from "@/lib/services/reports/reports";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// One hue, quiet to full
const STEPS = ["bg-muted", "bg-primary/20", "bg-primary/40", "bg-primary/65", "bg-primary"];
const step = (pct: number) => STEPS[pct <= 0 ? 0 : Math.min(4, 1 + Math.floor(pct / 25))];
const hourLabel = (h: number) => (h === 0 || h === 24 ? "12 AM" : h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`);

/** Weekday x hour: how full the courts were. Hours the venue never opened on a weekday stay blank. */
export function BusyHeatmap({ cells }: { cells: VenueReport["heatmap"] }) {
  if (cells.length === 0) {
    return <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">The venue had no open hours in this period.</p>;
  }
  const first = Math.min(...cells.map((c) => c.hour));
  const last = Math.max(...cells.map((c) => c.hour));
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const at = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.pct]));

  return (
    <div className="mt-4 overflow-x-auto">
      <div className="grid min-w-[520px] gap-0.5 text-xs text-muted-foreground" style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(0, 1fr))` }}>
        <span />
        {hours.map((h) => <span key={h} className="text-center">{(h - first) % 3 === 0 ? hourLabel(h).replace(" ", "").toLowerCase() : ""}</span>)}
        {DAYS.map((day, dow) => (
          <div key={day} className="contents">
            <span className="self-center">{day}</span>
            {hours.map((h) => {
              const pct = at.get(`${dow}-${h}`);
              if (pct === undefined) return <div key={h} className="h-5 rounded-[3px] border border-dashed border-border/60" aria-hidden="true" />;
              const label = `${day} ${hourLabel(h)}: ${pct}% booked`;
              return <div key={h} role="img" aria-label={label} title={label} className={`h-5 rounded-[3px] ${step(pct)}`} />;
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
        Quiet {STEPS.map((s) => <i key={s} className={`inline-block h-2.5 w-4 rounded-[2px] ${s}`} />)} Full
      </div>
    </div>
  );
}
