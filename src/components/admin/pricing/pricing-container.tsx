"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { fetchPricing } from "@/lib/services/pricing/fetchPricing.service";
import { WEEKDAYS, type PeakRate } from "@/lib/services/pricing/quoteCourtPrice";
import { formatTime12h } from "@/lib/utils/formatTime";

type Window = Omit<PeakRate, "id"> & { key: number };

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function PricingContainer() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseRate, setBaseRate] = useState("");
  const [minHours, setMinHours] = useState(1);
  const [maxHours, setMaxHours] = useState(3);
  const [windows, setWindows] = useState<Window[]>([]);

  useEffect(() => {
    fetchPricing(supabase).then(({ data }) => {
      if (data) {
        setBaseRate(String(data.settings.base_hourly_rate));
        setMinHours(data.settings.min_hours);
        setMaxHours(data.settings.max_hours);
        setWindows(data.peakRates.map((p, i) => ({ ...p, start_time: p.start_time.slice(0, 5), end_time: p.end_time.slice(0, 5), key: i })));
      } else {
        toast.error("Could not load pricing.");
      }
      setLoading(false);
    });
  }, []);

  const update = (key: number, patch: Partial<Window>) =>
    setWindows((prev) => prev.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  const toggleDay = (w: Window, day: string) =>
    update(w.key, { days: w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day] });
  const addWindow = () =>
    setWindows((prev) => [...prev, { key: Date.now(), label: "", days: WEEKDAYS.slice(0, 5), start_time: "17:00", end_time: "22:00", hourly_rate: Number(baseRate) || 0 }]);

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
    if (res.ok) toast.success("Pricing saved. New bookings use these rates.");
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

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Existing bookings keep the price they were booked at.</p>
        <Button onClick={save} disabled={saving} className="gap-2 font-bold">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save Pricing
        </Button>
      </div>
    </div>
  );
}
