/** What the Reports page shows, as returned by public.get_venue_report (definitions: docs/superpowers/specs/2026-11-05-admin-reports-design.md). */
export type PeriodKey = "week" | "month" | "last_month" | "custom" | "all";

export interface ReportSeriesRow {
    key: string;
    net: number;
    cash: number;
    gcash: number;
    card: number;
    refunded: number;
    bookings: number;
    court_hours: number;
}

export interface VenueReport {
    period: { from: string; to: string; through: string; bucket: "day" | "month" };
    money: { net: number; cash: number; gcash: number; card: number; refunded: number; refunded_count: number; court: number; open_play: number };
    bookings: { count: number; court_hours: number; cancelled: number; no_shows: number; money_kept: number };
    /** The same number of days at the start of the period before; null for all time or a period not started yet */
    previous: { net: number; count: number; cancelled_and_no_shows: number } | null;
    /** This period's days that have happened, to compare with `previous` */
    so_far: { net: number; count: number; cancelled_and_no_shows: number } | null;
    occupancy: { pct: number | null; booked_hours: number; open_hours: number };
    courts: { id: string; name: string; pct: number | null }[];
    heatmap: { dow: number; hour: number; pct: number }[];
    series: ReportSeriesRow[];
    top_customers: { name: string; visits: number; hours: number; spent: number; last_visit: string | null }[];
}

// Dates stay as YYYY-MM-DD strings; UTC maths on them never shifts a day
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];

/** Today in the venue's time zone (Asia/Manila), YYYY-MM-DD. */
export const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/** The dates a period button stands for; `from` is null for all time. */
export function periodRange(key: PeriodKey, today: string, custom?: { from: string; to: string }): { from: string | null; to: string } {
    const [y, m, d] = parts(today);
    const t = Date.UTC(y, m - 1, d);
    switch (key) {
        case "week": {
            const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000;
            return { from: iso(monday), to: iso(monday + 6 * 86_400_000) };
        }
        case "month":
            return { from: iso(Date.UTC(y, m - 1, 1)), to: iso(Date.UTC(y, m, 0)) };
        case "last_month":
            return { from: iso(Date.UTC(y, m - 2, 1)), to: iso(Date.UTC(y, m - 1, 0)) };
        case "custom":
            return custom ? { from: custom.from, to: custom.to } : { from: today, to: today };
        case "all":
            return { from: null, to: today };
    }
}

/** Whole-number % change; null when there is no earlier figure to compare with. */
export function pctChange(current: number, previous: number | null | undefined): number | null {
    if (!previous) return null;
    return Math.round(((current - previous) / previous) * 100);
}

/** One line per chart bucket, for the owner's accountant. */
export function reportCsv(report: Pick<VenueReport, "period" | "series">): string {
    const head = `${report.period.bucket === "month" ? "Month" : "Date"},Bookings,Court hours,Cash,GCash,Card,Refunded,Net`;
    const lines = report.series.map((r) => [r.key, r.bookings, r.court_hours, r.cash, r.gcash, r.card, r.refunded, r.net].join(","));
    return [head, ...lines].join("\n") + "\n";
}
