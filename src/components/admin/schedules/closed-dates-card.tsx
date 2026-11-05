"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, CalendarOff, LoaderCircle, X } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatManilaDate } from "@/lib/utils/bookingTime"
import { formatShortDate, formatTime12h } from "@/lib/utils/formatTime"
import {
  AffectedBooking,
  VenueClosure,
  addClosure,
  fetchBookedOnDate,
  fetchUpcomingClosures,
  removeClosure,
} from "@/lib/services/schedule/venueClosures.service"

/** One-off whole-day closures (holidays, typhoons, private events) on top of the weekly hours. */
export const ClosedDatesCard = () => {
  const [closures, setClosures] = useState<VenueClosure[]>([])
  const [date, setDate] = useState("")
  const [reason, setReason] = useState("")
  const [affected, setAffected] = useState<AffectedBooking[]>([])
  const [busy, setBusy] = useState(false)

  const load = () => fetchUpcomingClosures().then(({ data }) => setClosures(data))

  useEffect(() => {
    load()
  }, [])

  // Closing a date leaves its bookings in place: list them before staff confirm
  useEffect(() => {
    if (!date) return
    let ignore = false
    fetchBookedOnDate(date).then(({ data }) => !ignore && setAffected(data))
    return () => {
      ignore = true
    }
  }, [date])

  const add = async () => {
    if (!date) return
    setBusy(true)
    const { error } = await addClosure(date, reason)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(`Closed on ${formatShortDate(date)}. Customers can no longer book it.`)
    setDate("")
    setReason("")
    setAffected([])
    load()
  }

  const remove = async (closedOn: string) => {
    const { error } = await removeClosure(closedOn)
    if (error) return toast.error(error.message)
    toast.success(`${formatShortDate(closedOn)} is open for bookings again.`)
    load()
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-xl font-bold">
          <CalendarOff className="h-5 w-5 text-primary" />
          Closed Dates
        </CardTitle>
        <CardDescription className="mt-1">
          Close the venue for a single day, such as a holiday, bad weather or a private event. Customers can&apos;t book a
          closed date; staff can still record walk-ins.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="closure-date">Date</Label>
            <Input
              id="closure-date"
              type="date"
              min={formatManilaDate()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setAffected([])
              }}
              className="sm:w-44"
            />
          </div>
          <div className="flex flex-col gap-2 flex-1">
            <Label htmlFor="closure-reason">Reason (optional)</Label>
            <Input
              id="closure-reason"
              placeholder="e.g. Christmas Day"
              maxLength={120}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button onClick={add} disabled={!date || busy} className="gap-2">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Close this date
          </Button>
        </div>

        {date && affected.length > 0 && (
          <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="size-3.5 shrink-0" />
              {affected.length} {affected.length === 1 ? "booking is" : "bookings are"} already on {formatShortDate(date)}
            </p>
            <p className="mt-1">Closing the date does not cancel them. Contact these players, or cancel from Bookings or Open Play.</p>
            <ul className="mt-2 max-h-36 space-y-1 overflow-auto">
              {affected.map((b) => (
                <li key={b.id}>
                  <span className="font-semibold">{b.label}</span> · {formatTime12h(b.start_time)}
                  {b.phone && (
                    <>
                      {" · "}
                      <a href={`tel:${b.phone}`} className="underline underline-offset-2">{b.phone}</a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {closures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming closed dates.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border">
            {closures.map((c) => (
              <li key={c.closed_on} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{formatShortDate(c.closed_on)}</span>
                  {c.reason && <span className="text-muted-foreground"> · {c.reason}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(c.closed_on)}
                  className="gap-1 text-muted-foreground"
                  aria-label={`Reopen ${formatShortDate(c.closed_on)}`}
                >
                  <X className="h-4 w-4" />
                  Reopen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
