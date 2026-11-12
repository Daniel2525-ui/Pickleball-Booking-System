"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils/formatTime";
import type { DiscountKind } from "@/lib/services/pricing/discounts";

interface DiscountCode {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  uses: number;
}

interface CodeUse {
  id: string;
  basket_id: string | null;
  discount_code_id: string;
  discount_amount: number | string;
  status: string;
  booking_date: string;
  created_at: string;
  customer_name: string | null;
  profiles: { full_name: string | null; is_guest: boolean } | null;
}

const EMPTY = { code: "", kind: "percent" as DiscountKind, value: "", starts_on: "", ends_on: "", max_uses: "" };
type Form = typeof EMPTY;

const offLabel = (c: { kind: DiscountKind; value: number }) => (c.kind === "percent" ? `${c.value}% off` : `₱${c.value.toLocaleString()} off`);
const datesLabel = (c: DiscountCode) =>
  c.starts_on && c.ends_on ? `${formatDate(c.starts_on)} – ${formatDate(c.ends_on)}`
    : c.starts_on ? `From ${formatDate(c.starts_on)}`
      : c.ends_on ? `Until ${formatDate(c.ends_on)}`
        : "Any day";

/** The owner's discount codes: create, switch on or off, edit, and see which checkouts used them. */
export function DiscountsContainer() {
  const [codes, setCodes] = useState<DiscountCode[] | null>(null);
  const [uses, setUses] = useState<CodeUse[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<DiscountCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/discounts");
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      toast.error(data?.error ?? "Could not load discount codes.");
      setCodes([]);
      return;
    }
    setCodes(data.codes);
    setUses(data.uses);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once on mount
    load();
  }, [load]);

  const startEdit = (c: DiscountCode) => {
    setEditing(c);
    setError(null);
    setForm({ code: c.code, kind: c.kind, value: String(c.value), starts_on: c.starts_on ?? "", ends_on: c.ends_on ?? "", max_uses: c.max_uses ? String(c.max_uses) : "" });
  };
  const cancelEdit = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/discounts", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      // An edit leaves on/off alone: the switch is the only thing that changes it
      body: JSON.stringify({ ...form, value: Number(form.value), ...(editing ? { id: editing.id } : {}) }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) return setError(data?.error ?? "Could not save the code.");
    toast.success(editing ? `Code ${form.code.toUpperCase()} saved.` : `Code ${form.code.toUpperCase()} created.`);
    cancelEdit();
    load();
  };

  const setActive = async (c: DiscountCode, active: boolean) => {
    const res = await fetch("/api/admin/discounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...c, active }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return toast.error(data?.error ?? "Could not change the code.");
    toast.success(`${c.code} is ${active ? "on" : "off"}.`);
    load();
  };

  const used = editing ? editing.uses > 0 || uses.some((u) => u.discount_code_id === editing.id) : false;
  const codeById = new Map((codes ?? []).map((c) => [c.id, c.code]));
  // One row per checkout: a checkout of several courts shares its basket
  const checkouts = Object.values(
    uses.reduce<Record<string, CodeUse & { off: number }>>((acc, u) => {
      const key = u.basket_id ?? u.id;
      const prev = acc[key];
      acc[key] = prev ? { ...prev, off: prev.off + Number(u.discount_amount) } : { ...u, off: Number(u.discount_amount) };
      return acc;
    }, {})
  ).slice(0, 50);

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold">{editing ? `Edit ${editing.code}` : "New code"}</CardTitle>
          <CardDescription>
            {editing && used
              ? "This code has been used, so its dates, limit and on/off can change but not the code or the amount."
              : "Players type the code at checkout. A percent comes off every court; a peso amount comes off the whole booking."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" value={form.code} disabled={used} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER10" className="uppercase" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span id="kind-label" className="text-sm font-medium">Discount</span>
            <div role="group" aria-labelledby="kind-label" className="flex gap-2">
              <div className="flex rounded-lg bg-muted p-0.5">
                {(["percent", "fixed"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={used}
                    aria-pressed={form.kind === k}
                    onClick={() => setForm({ ...form, kind: k })}
                    className={`min-h-9 rounded-md px-3 text-sm font-semibold whitespace-nowrap ${form.kind === k ? "bg-card shadow-xs text-primary" : "text-muted-foreground"}`}
                  >
                    {k === "percent" ? "% off" : "₱ off"}
                  </button>
                ))}
              </div>
              <Input
                aria-label={form.kind === "percent" ? "Percent off" : "Pesos off"}
                type="number"
                min={1}
                max={form.kind === "percent" ? 90 : undefined}
                value={form.value}
                disabled={used}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                placeholder={form.kind === "percent" ? "10" : "100"}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max-uses">Most uses (optional)</Label>
            <Input id="max-uses" type="number" min={1} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="No limit" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="starts-on">Starts (optional)</Label>
            <Input id="starts-on" type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ends-on">Ends (optional)</Label>
            <Input id="ends-on" type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={save} disabled={saving} className="gap-2 font-bold">
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              {editing ? "Save code" : "Create code"}
            </Button>
            {editing && (
              <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{error}</p>}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold">Codes</CardTitle>
          <CardDescription>A use is a checkout that is paid, played, or still being paid. A cancelled one gives its use back.</CardDescription>
        </CardHeader>
        <CardContent>
          {codes === null ? (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : codes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No codes yet. Create one above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>On</TableHead>
                  <TableHead className="sr-only">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-bold">{c.code}</TableCell>
                    <TableCell>{offLabel(c)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{datesLabel(c)}</TableCell>
                    <TableCell className="tabular-nums">{c.uses}{c.max_uses ? ` / ${c.max_uses}` : ""}</TableCell>
                    <TableCell>
                      <Switch checked={c.active} onCheckedChange={(on) => setActive(c, on)} aria-label={`${c.code} ${c.active ? "on" : "off"}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(c)} className="gap-1.5" aria-label={`Edit ${c.code}`}>
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold flex items-center gap-2"><Tag className="size-4.5 text-primary" />Recent uses</CardTitle>
          <CardDescription>The latest checkouts that used a code.</CardDescription>
        </CardHeader>
        <CardContent>
          {checkouts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No checkout has used a code yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Booking date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Off</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkouts.map((u) => (
                  <TableRow key={u.basket_id ?? u.id}>
                    <TableCell className="font-mono font-semibold">{codeById.get(u.discount_code_id) ?? "—"}</TableCell>
                    <TableCell>
                      {u.profiles?.full_name || u.customer_name || "Player"}
                      {u.profiles?.is_guest && <span className="ml-1.5 text-xs text-muted-foreground">(guest)</span>}
                    </TableCell>
                    <TableCell>{formatDate(u.booking_date)}</TableCell>
                    <TableCell className="capitalize">{u.status.replace("_", " ")}</TableCell>
                    <TableCell className="text-right tabular-nums">₱{u.off.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
