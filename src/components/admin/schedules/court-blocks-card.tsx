"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Ban, LoaderCircle, X } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatManilaDate } from "@/lib/utils/bookingTime"
import { formatShortDate, formatTime12h } from "@/lib/utils/formatTime"
import { CourtBlock, addBlock, fetchCourtNames, fetchUpcomingBlocks, removeBlock } from "@/lib/services/schedule/courtBlocks.service"

/** One court out for part of a day (coaching, private event, tournament, repairs). Nobody can book those hours. */
export const CourtBlocksCard = () => {
  const [blocks, setBlocks] = useState<CourtBlock[]>([])
  const [courts, setCourts] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({ courtId: "", date: "", start: "", end: "", reason: "" })
  const [busy, setBusy] = useState(false)

  const load = () => fetchUpcomingBlocks().then(({ data }) => setBlocks(data))

  useEffect(() => {
    load()
    fetchCourtNames().then(setCourts)
  }, [])

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const ready = form.courtId && form.date && form.start && form.end
  const courtName = courts.find((c) => c.id === form.courtId)?.name ?? ""

  const add = async () => {
    if (!ready) return
    if (form.end <= form.start) return toast.error("The end time must be after the start time.")
    setBusy(true)
    const { error } = await addBlock(form)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(`${courtName} blocked on ${formatShortDate(form.date)}, ${formatTime12h(form.start)} – ${formatTime12h(form.end)}.`)
    setForm((f) => ({ ...f, start: "", end: "", reason: "" }))
    load()
  }

  const remove = async (b: CourtBlock) => {
    const { error } = await removeBlock(b.id)
    if (error) return toast.error(error.message)
    toast.success(`${b.courts?.name ?? "Court"} is bookable again on ${formatShortDate(b.block_date)}.`)
    load()
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-xl font-bold">
          <Ban className="h-5 w-5 text-primary" />
          Court Blocks
        </CardTitle>
        <CardDescription className="mt-1">
          Take one court out for a few hours, such as coaching, a private event or a tournament. Nobody can book those
          hours, staff included. Players see them as booked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_11rem_8rem_8rem_1fr_auto] lg:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-court">Court</Label>
            <Select value={form.courtId} onValueChange={(v) => set("courtId")(v ?? "")}>
              <SelectTrigger id="block-court">
                <SelectValue placeholder="Choose a court">{() => courtName || "Choose a court"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {courts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-date">Date</Label>
            <Input id="block-date" type="date" min={formatManilaDate()} value={form.date} onChange={(e) => set("date")(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-start">From</Label>
            <Input id="block-start" type="time" step={3600} value={form.start} onChange={(e) => set("start")(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-end">Until</Label>
            <Input id="block-end" type="time" step={3600} value={form.end} onChange={(e) => set("end")(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-reason">Reason (optional)</Label>
            <Input id="block-reason" placeholder="e.g. Coaching clinic" maxLength={120} value={form.reason} onChange={(e) => set("reason")(e.target.value)} />
          </div>
          <Button onClick={add} disabled={!ready || busy} className="gap-2">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Block court
          </Button>
        </div>

        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming court blocks.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{b.courts?.name ?? "Court"}</span> · {formatShortDate(b.block_date)},{" "}
                  {formatTime12h(b.start_time)} – {formatTime12h(b.end_time)}
                  {b.reason && <span className="text-muted-foreground"> · {b.reason}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(b)}
                  className="gap-1 text-muted-foreground"
                  aria-label={`Remove block on ${b.courts?.name ?? "court"}, ${formatShortDate(b.block_date)} ${formatTime12h(b.start_time)}`}
                >
                  <X className="h-4 w-4" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
