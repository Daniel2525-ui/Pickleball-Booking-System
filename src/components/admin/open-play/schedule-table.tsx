"use client";

import { useState } from "react";
import { Loader2, Plus, AlertCircle, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Court } from "@/lib/services/courts/courtsTypes";
import { formatTime12h } from "@/lib/utils/formatTime";
import type { OpenPlaySchedule } from "./open-play-container";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface Props {
  schedules: OpenPlaySchedule[];
  courts: Court[];
  loading: boolean;
  onChanged: () => void;
}

export function ScheduleTable({ schedules, courts, loading, onChanged }: Props) {
  // null = closed, {} = new, a schedule = editing it
  const [editing, setEditing] = useState<Partial<OpenPlaySchedule> | null>(null);
  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? "Court";

  const remove = async (s: OpenPlaySchedule) => {
    const res = await fetch("/api/admin/open-play/schedules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, active: false }),
    });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Could not remove the schedule.");
    toast.success("Schedule removed. Future sessions nobody booked are gone.");
    onChanged();
  };

  return (
    <Card className="border border-border shadow-2xs">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base font-bold">Weekly schedule</CardTitle>
        <Button size="sm" className="gap-2 font-bold" onClick={() => setEditing({})}>
          <Plus className="h-4 w-4" />
          Add weekly session
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Courts</TableHead>
              <TableHead>Spots</TableHead>
              <TableHead>Price</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
            ) : schedules.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No weekly sessions yet.</TableCell></TableRow>
            ) : (
              [...schedules]
                .sort((a, b) => DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week) || a.start_time.localeCompare(b.start_time))
                .map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-semibold">Every {s.day_of_week}</TableCell>
                    <TableCell>{formatTime12h(s.start_time)} – {formatTime12h(s.end_time)}</TableCell>
                    <TableCell>{s.court_ids.map(courtName).join(", ")}</TableCell>
                    <TableCell>{s.capacity}</TableCell>
                    <TableCell>₱{Number(s.price_per_spot).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Actions"
                            className="inline-flex items-center justify-center rounded-lg h-8 w-8 p-0 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        }
                        >
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => setEditing(s)} className="cursor-pointer text-xs font-semibold">
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => remove(s)} className="cursor-pointer text-destructive focus:text-destructive text-xs font-semibold">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">Changes apply to future sessions nobody has booked yet.</p>
      </CardContent>
      {editing && (
        <ScheduleModal key={editing.id ?? "new"} initial={editing} courts={courts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </Card>
  );
}

function ScheduleModal({ initial, courts, onClose, onSaved }: { initial: Partial<OpenPlaySchedule>; courts: Court[]; onClose: () => void; onSaved: () => void }) {
  const [day, setDay] = useState(initial.day_of_week ?? "Tuesday");
  const [start, setStart] = useState(initial.start_time?.slice(0, 5) ?? "18:00");
  const [end, setEnd] = useState(initial.end_time?.slice(0, 5) ?? "21:00");
  const [courtIds, setCourtIds] = useState<string[]>(initial.court_ids ?? []);
  const [capacity, setCapacity] = useState(String(initial.capacity ?? 16));
  const [price, setPrice] = useState(String(initial.price_per_spot ?? 150));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (courtIds.length === 0) return setError("Choose at least one court.");
    setSaving(true);
    const res = await fetch("/api/admin/open-play/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: initial.id,
        day_of_week: day,
        start_time: start,
        end_time: end,
        court_ids: courtIds,
        capacity: Number(capacity),
        price_per_spot: Number(price),
      }),
    });
    setSaving(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not save the schedule.");
    toast.success("Schedule saved.");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial.id ? "Edit weekly session" : "Add weekly session"}</DialogTitle>
          <DialogDescription>Hours must start and end on the hour. Courts are held for the whole session.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-day" className="text-xs font-semibold">Day</Label>
            <Select value={day} onValueChange={(v) => setDay(v as string)}>
              <SelectTrigger id="op-day" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{DAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-start" className="text-xs font-semibold">Start</Label>
              <Input id="op-start" type="time" step={3600} value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-end" className="text-xs font-semibold">End</Label>
              <Input id="op-end" type="time" step={3600} value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-semibold mb-1">Courts</legend>
            {courts.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={courtIds.includes(c.id)}
                  onChange={(e) => setCourtIds((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((id) => id !== c.id)))}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-capacity" className="text-xs font-semibold">Spots</Label>
              <Input id="op-capacity" type="number" min={1} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-price" className="text-xs font-semibold">Price per spot (₱)</Label>
              <Input id="op-price" type="number" min={1} step="any" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="gap-2 font-bold">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving..." : "Save schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
