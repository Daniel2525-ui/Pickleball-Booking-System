"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Plus, Save, Trash2, Zap } from "lucide-react";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service";
import { pricingChanges } from "@/lib/services/pricing/pricingChanges";
import type { OperatingHour } from "@/components/admin/schedules/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { fetchPricing } from "@/lib/services/pricing/fetchPricing.service";
import { WEEKDAYS, hourlyRate, type PeakRate, type Pricing } from "@/lib/services/pricing/quoteCourtPrice";
import { formatTime12h } from "@/lib/utils/formatTime";

type Window = Omit<PeakRate, "id"> & { key: number };

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";
// A date for each weekday (2026-11-02 is a Monday), so the preview can price an hour on that day
const SAMPLE_DATE: Record<string, string> = Object.fromEntries(WEEKDAYS.map((d, i) => [d, `2026-11-${String(2 + i).padStart(2, "0")}`]));
const hourOf = (t: string | null | undefined) => (t ? parseInt(t.slice(0, 2), 10) : NaN);

/** Days a peak window covers on which it can never apply: the venue is closed, or the window is outside opening hours. */
const daysWithoutEffect = (w: Pick<PeakRate, "days" | "start_time" | "end_time">, hours: OperatingHour[]) =>
  w.days.filter((day) => {
    const h = hours.find((x) => x.day_of_week === day);
    if (!h?.is_open || !h.open_time || !h.close_time) return true;
    return hourOf(w.start_time) >= hourOf(h.close_time) || hourOf(w.end_time) <= hourOf(h.open_time);
  });

export function PricingContainer() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseRate, setBaseRate] = useState("");
  const [minHours, setMinHours] = useState(1);
  const [maxHours, setMaxHours] = useState(3);
  const [windows, setWindows] = useState<Window[]>([]);
  const [saved, setSaved] = useState<Pricing | null>(null);
  const [hours, setHours] = useState<OperatingHour[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [history, setHistory] = useState<PricingChange[] | null>(null);

  // Last few saves (pricing_changes, written by save_pricing_settings; staff only)
  const loadHistory = () =>
    supabase
      .from("pricing_changes")
      .select("id, changed_at, before, after, profiles(full_name)")
      .order("changed_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory((data ?? []) as unknown as PricingChange[]));

  useEffect(() => {
    fetchPricing(supabase).then(({ data }) => {
      if (data) {
        setBaseRate(String(data.settings.base_hourly_rate));
        setMinHours(data.settings.min_hours);
        setMaxHours(data.settings.max_hours);
        setWindows(data.peakRates.map((p, i) => ({ ...p, start_time: p.start_time.slice(0, 5), end_time: p.end_time.slice(0, 5), key: i })));
        setSaved(data);
      } else {
        toast.error("Could not load pricing.");
      }
      setLoading(false);
    });
    fetchOperatingHours().then(({ data }) => setHours(data));
    loadHistory();
  }, []);

  // The form as it would be saved, for the preview, the change summary and the unsaved-changes prompt
  const form: Pricing = {
    settings: { base_hourly_rate: Number(baseRate), min_hours: minHours, max_hours: maxHours },
    peakRates: windows.map(({ label, days, start_time, end_time, hourly_rate }) => ({ label, days, start_time, end_time, hourly_rate: Number(hourly_rate) })),
  };
  const changes = saved ? pricingChanges(saved, form) : [];
  const dirty = changes.length > 0;

  // Reloading or closing the tab with unsaved prices asks first
  // shortcut: sidebar links still leave without asking; intercept router navigation if staff lose edits that way
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (key: number, patch: Partial<Window>) =>
    setWindows((prev) => prev.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  const toggleDay = (w: Window, day: string) =>
    update(w.key, { days: w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day] });
  const addWindow = () =>
    setWindows((prev) => [...prev, { key: Date.now(), label: "", days: WEEKDAYS.slice(0, 5), start_time: "17:00", end_time: "22:00", hourly_rate: Number(baseRate) || 0 }]);

  // Customers see new prices at once: show what changes, and save only when staff confirm
  const askSave = () => {
    if (!dirty) return toast.info("Nothing has changed.");
    setConfirmRequest({
      title: "Save these prices?",
      description: `Customers see them right away. Existing bookings keep their price.\n\n${changes.join("\n")}`,
      confirmLabel: "Save Pricing",
      onConfirm: save,
    });
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/admin/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_hourly_rate: Number(baseRate),
        min_hours: minHours,
        max_hours: maxHours,
        peak_rates: windows.map(({ label, days, start_time, end_time, hourly_rate }) => ({ label, days, start_time, end_time, hourly_rate: Number(hourly_rate) })),
      }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);
    if (res.ok) {
      setSaved(form);
      loadHistory();
      toast.success("Pricing saved. New bookings use these rates.");
    }
    else toast.error(body?.error || "Could not save pricing.");
  };

  if (loading) return <Loader2 className="size-6 animate-spin text-primary" />;

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold">Standard Rate &amp; Booking Length</CardTitle>
          <CardDescription>Applies to every court and hour outside the peak windows below.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="base-rate">Base rate (₱ per hour)</Label>
            <Input id="base-rate" type="number" min={1} value={baseRate} onChange={(e) => setBaseRate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="min-hours">Minimum booking (hours)</Label>
            <Input id="min-hours" type="number" min={1} max={12} value={minHours} onChange={(e) => setMinHours(Number(e.target.value))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max-hours">Maximum booking (hours)</Label>
            <Input id="max-hours" type="number" min={1} max={12} value={maxHours} onChange={(e) => setMaxHours(Number(e.target.value))} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <Zap className="h-5 w-5 text-primary" />
              Peak Rates
            </CardTitle>
            <CardDescription>
              Each booked hour that starts inside a window costs that window&apos;s rate. If windows overlap, the highest rate applies.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={addWindow} className="gap-2 self-start">
            <Plus className="size-4" /> Add Peak Window
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {windows.length === 0 && (
            <p className="text-sm text-muted-foreground">No peak windows: every hour costs the base rate.</p>
          )}
          {windows.map((w, i) => (
            <div key={w.key} className="rounded-lg border p-3 flex flex-col gap-3" data-testid="peak-window">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`peak-label-${w.key}`}>Name</Label>
                  <Input id={`peak-label-${w.key}`} value={w.label} placeholder={`Peak ${i + 1}`} onChange={(e) => update(w.key, { label: e.target.value })} className="w-40" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`peak-start-${w.key}`}>From</Label>
                  <select id={`peak-start-${w.key}`} className={selectClass} value={w.start_time} onChange={(e) => update(w.key, { start_time: e.target.value })}>
                    {HOURS.map((h) => <option key={h} value={h}>{formatTime12h(h)}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`peak-end-${w.key}`}>Until</Label>
                  <select id={`peak-end-${w.key}`} className={selectClass} value={w.end_time} onChange={(e) => update(w.key, { end_time: e.target.value })}>
                    {HOURS.slice(1).map((h) => <option key={h} value={h}>{formatTime12h(h)}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`peak-rate-${w.key}`}>Rate (₱/hr)</Label>
                  <Input id={`peak-rate-${w.key}`} type="number" min={1} value={w.hourly_rate} onChange={(e) => update(w.key, { hourly_rate: Number(e.target.value) })} className="w-28" />
                </div>
                <Button variant="ghost" size="icon" aria-label={`Remove peak window ${i + 1}`} onClick={() => setWindows((prev) => prev.filter((x) => x.key !== w.key))}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              {(() => {
                const idle = daysWithoutEffect(w, hours);
                if (!hours.length || idle.length === 0) return null;
                return (
                  <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                    {idle.length === w.days.length
                      ? "This window is outside opening hours on every day it covers, so it never applies."
                      : `No effect on ${idle.map((d) => d.slice(0, 3)).join(", ")}: closed or outside opening hours then.`}
                  </p>
                );
              })()}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={w.days.includes(day)}
                    onClick={() => toggleDay(w, day)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${w.days.includes(day) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <PricePreview pricing={form} hours={hours} />

      <p className="text-xs text-muted-foreground">
        Open play is priced per spot on each schedule, on the{" "}
        <Link href="/admin/open-play" className="font-semibold underline underline-offset-2">Open Play</Link> page.
      </p>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {dirty ? "You have unsaved changes. " : ""}Existing bookings keep the price they were booked at.
        </p>
        <Button onClick={askSave} disabled={saving} className="gap-2 font-bold">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save Pricing
        </Button>
      </div>
      <RecentChanges history={history} />
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}

interface PricingChange {
  id: number;
  changed_at: string;
  before: Pricing;
  after: Pricing;
  profiles: { full_name: string | null } | null;
}

/** Who changed the prices, when, and what changed. */
function RecentChanges({ history }: { history: PricingChange[] | null }) {
  if (history === null) return null;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Recent Price Changes</CardTitle>
        <CardDescription>The last five saves, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No price changes recorded yet. Changes are recorded from when this feature went live.</p>
        ) : (
          <ol className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-3 text-sm">
                <p>
                  <span className="font-semibold text-foreground">{h.profiles?.full_name?.trim() || "Staff"}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {new Date(h.changed_at).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </p>
                <ul className="text-xs text-muted-foreground">
                  {pricingChanges(h.before, h.after).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** What a customer pays for each hour of the week with the form as it stands, inside opening hours. */
function PricePreview({ pricing, hours }: { pricing: Pricing; hours: OperatingHour[] }) {
  const open = hours.filter((h) => h.is_open && h.open_time && h.close_time);
  if (!open.length || !(pricing.settings.base_hourly_rate > 0)) return null;
  const first = Math.min(...open.map((h) => hourOf(h.open_time)));
  const last = Math.max(...open.map((h) => hourOf(h.close_time)));
  const rows = Array.from({ length: last - first }, (_, i) => first + i);
  const base = pricing.settings.base_hourly_rate;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Price Preview</CardTitle>
        <CardDescription>What a customer pays for each hour, before you save. Highlighted hours are peak.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs" aria-label="Price per hour by day">
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left font-semibold text-muted-foreground">Hour</th>
              {WEEKDAYS.map((d) => (
                <th key={d} className="py-1 px-1 text-center font-semibold text-muted-foreground">{d.slice(0, 3)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const time = `${String(h).padStart(2, "0")}:00`;
              return (
                <tr key={h} className="border-t border-border/50">
                  <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">{formatTime12h(time)}</td>
                  {WEEKDAYS.map((d) => {
                    const day = hours.find((x) => x.day_of_week === d);
                    const inHours = day?.is_open && hourOf(day.open_time) <= h && h < hourOf(day.close_time);
                    if (!inHours) return <td key={d} className="py-1 px-1 text-center text-muted-foreground/50">—</td>;
                    const rate = hourlyRate(pricing, SAMPLE_DATE[d], time);
                    return (
                      <td key={d} className={`py-1 px-1 text-center tabular-nums ${rate !== base ? "bg-primary/10 font-semibold text-primary" : ""}`}>
                        ₱{rate.toLocaleString("en-PH")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
