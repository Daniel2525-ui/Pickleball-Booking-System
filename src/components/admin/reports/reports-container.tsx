"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, CalendarCheck, Download, Gauge, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import StatCard from "@/components/admin/dashboard/stat-card";
import { PeriodKey, VenueReport, pctChange, periodRange, reportCsv, todayManila } from "@/lib/services/reports/reports";
import { fetchVenueReport } from "@/lib/services/reports/reportsData.service";
import { BreakdownBars } from "./breakdown-bars";
import { BusyHeatmap } from "./busy-heatmap";
import { RevenueChart, bucketLabel, peso } from "./revenue-chart";
import { TopCustomers } from "./top-customers";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom" },
  { key: "all", label: "All time" },
];

const trend = (pct: number | null, lowerIsBetter = false) =>
  pct === null || pct === 0 ? "neutral" : (pct > 0) !== lowerIsBetter ? "positive" : "negative";
const change = (pct: number | null, against: string) => (pct === null ? null : `${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${Math.abs(pct)}% ${against}`.trim());

/** Admin-only overview of the venue for a period: money, bookings, busy hours and best customers. */
export function ReportsContainer() {
  // Read each render, so a tab left open past midnight picks up the new day for This week / This month
  const today = todayManila();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [custom, setCustom] = useState({ from: `${today.slice(0, 8)}01`, to: today });
  const [report, setReport] = useState<VenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const customInvalid = period === "custom" && (!custom.from || !custom.to || custom.from > custom.to);
  const range = useMemo(() => periodRange(period, today, custom), [period, today, custom]);

  useEffect(() => {
    if (customInvalid) return;
    // A slower earlier request must not overwrite the period the owner picked last
    let current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the request started here
    setLoading(true);
    fetchVenueReport(range.from, range.to).then(({ data, error }) => {
      if (!current) return;
      setReport(data);
      setError(error);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [range, customInvalid, attempt]);

  const downloadCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([reportCsv(report)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    // Named from the report itself, so the file always matches the figures inside it
    link.download = `reports-${period === "all" ? "all-time" : report.period.from}-to-${report.period.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <header className="sticky top-14 z-20 -mx-4 flex flex-col gap-4 border-b border-border/60 bg-background/95 px-4 pb-4 pt-6 backdrop-blur-md sm:pt-7 lg:-mx-8 lg:flex-row lg:items-end lg:justify-between lg:px-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">How the venue is doing. Numbers include only money actually collected.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <Button key={p.key} size="sm" variant={period === p.key ? "default" : "ghost"} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
                {p.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={downloadCsv} disabled={!report || loading || customInvalid}>
            <Download className="size-4" /> Download CSV
          </Button>
        </div>
      </header>

      {period === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-from">From</Label>
            <Input id="report-from" type="date" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="w-44" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-to">To</Label>
            <Input id="report-to" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="w-44" />
          </div>
          {customInvalid && custom.from && custom.to && (
            <p role="alert" className="pb-2 text-sm text-destructive">Pick a start date on or before the end date.</p>
          )}
        </div>
      )}

      {customInvalid ? null : error ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </CardContent>
        </Card>
      ) : loading || !report ? (
        <ReportSkeleton />
      ) : (
        <ReportBody report={report} />
      )}
    </>
  );
}

function ReportBody({ report }: { report: VenueReport }) {
  const { money, bookings, previous, so_far: soFar, occupancy, period } = report;
  const partial = period.through < period.to;
  // A period still under way is compared with the same number of days before it
  const against = partial ? "vs the same days before" : "vs previous period";
  const netPct = soFar ? pctChange(soFar.net, previous?.net) : null;
  const countPct = soFar ? pctChange(soFar.count, previous?.count) : null;
  const lost = bookings.cancelled + bookings.no_shows;
  const lostDiff = soFar && previous ? soFar.cancelled_and_no_shows - previous.cancelled_and_no_shows : null;
  // No comparison at all: either all time, or a period that hasn't started
  const noComparison = period.through < period.from ? "Not started yet" : "All time";
  const best = report.series.reduce((a, b) => (b.net > a.net ? b : a), report.series[0]);
  const moneyMax = Math.max(money.cash, money.gcash + money.card, money.refunded);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Net revenue" value={peso(money.net)} icon={Wallet} trendType={trend(netPct)}
          description={change(netPct, against) ?? (previous ? "Nothing to compare with" : noComparison)} />
        <StatCard title="Bookings" value={bookings.count} icon={CalendarCheck} trendType={trend(countPct)}
          description={`${change(countPct, against) ? `${change(countPct, against)} · ` : ""}${bookings.court_hours} court-hours`} />
        <StatCard title="Courts full" value={occupancy.pct === null ? "—" : `${occupancy.pct}%`} icon={Gauge}
          description={occupancy.pct === null ? "The venue wasn't open" : `of open court-hours booked${partial ? " so far" : ""}`} />
        <StatCard title="Cancellations & no-shows" value={lost} icon={Ban}
          trendType={lostDiff === null || lostDiff === 0 ? "neutral" : lostDiff > 0 ? "negative" : "positive"}
          description={lostDiff === null ? noComparison : lostDiff === 0 ? `Same ${against.replace("vs ", "as ")}` : `${lostDiff > 0 ? "▲" : "▼"} ${Math.abs(lostDiff)} ${against}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Revenue per {period.bucket}</CardTitle>
            <CardDescription>
              Net of refunds.{best && best.net > 0 ? ` Best ${period.bucket}: ${bucketLabel(best.key, period.bucket)}, ${peso(best.net)}.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent><RevenueChart series={report.series} bucket={period.bucket} /></CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Where the money came from</CardTitle>
            <CardDescription>Check each against the cash drawer and the Xendit dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBars max={moneyMax} items={[
              { label: "Cash", value: money.cash, display: peso(money.cash) },
              { label: "QR Ph", value: money.gcash + money.card, display: peso(money.gcash + money.card) },
              { label: "Refunded", value: money.refunded, display: money.refunded ? `−${peso(money.refunded)}` : peso(0), muted: true },
            ]} />
            <dl className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
              <div className="flex justify-between"><dt>Court bookings</dt><dd className="font-semibold tabular-nums">{peso(money.court)}</dd></div>
              <div className="flex justify-between"><dt>Open play</dt><dd className="font-semibold tabular-nums">{peso(money.open_play)}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>When the courts are busy</CardTitle>
            <CardDescription>Share of courts booked, by weekday and hour{partial ? ", up to today" : ""}.</CardDescription>
          </CardHeader>
          <CardContent><BusyHeatmap cells={report.heatmap} /></CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Each court</CardTitle>
            <CardDescription>How full it was{partial ? " so far" : ""}.</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBars max={100} items={report.courts.map((c) => ({ label: c.name, value: c.pct, display: c.pct === null ? "—" : `${c.pct}%` }))} />
            <h3 className="mt-6 text-sm font-semibold">Cancellations &amp; no-shows</h3>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div className="rounded-lg bg-muted/50 p-2.5"><dt>Cancelled</dt><dd className="mt-1 text-lg font-bold text-foreground tabular-nums">{bookings.cancelled}</dd></div>
              <div className="rounded-lg bg-muted/50 p-2.5"><dt>No-shows</dt><dd className="mt-1 text-lg font-bold text-foreground tabular-nums">{bookings.no_shows}</dd></div>
              <div className="rounded-lg bg-muted/50 p-2.5"><dt>Money kept</dt><dd className="mt-1 text-lg font-bold text-foreground tabular-nums">{peso(bookings.money_kept)}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Best customers</CardTitle>
          <CardDescription>Top players in this period by money spent.</CardDescription>
        </CardHeader>
        <CardContent><TopCustomers customers={report.top_customers} /></CardContent>
      </Card>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}
