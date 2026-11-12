"use client"

import { useState, useEffect } from "react"
import { useUnsavedChangesPrompt } from "@/hooks/use-unsaved-changes-prompt"
import { toast } from "sonner"
import { Save, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OperatingHoursCard } from "./operating-hours-card"
import { ClosedDatesCard } from "./closed-dates-card"
import { CourtBlocksCard } from "./court-blocks-card"
import { OperatingHour } from "./types"
import { ScheduleSkeleton } from "@/components/skeletons/schedule-skeleton"
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service"
import { updateOperatingHours } from "@/lib/services/schedule/updateOperatingHours.service"
import { checkWeeklyHours } from "@/lib/services/schedule/hoursRules"
import { findHoursConflicts } from "@/lib/services/schedule/hoursConflicts.service"
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog"
import { supabase } from "@/lib/supabase"
import { formatTime12h } from "@/lib/utils/formatTime"

const defaultHours: OperatingHour[] = [
  { day_of_week: "Monday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Tuesday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Wednesday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Thursday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Friday", is_open: true, open_time: "08:00", close_time: "23:00" },
  { day_of_week: "Saturday", is_open: true, open_time: "07:00", close_time: "23:00" },
  { day_of_week: "Sunday", is_open: false, open_time: "", close_time: "" },
]

// Midnight (no late-night hours) to 6 AM
const DAY_END_OPTIONS = Array.from({ length: 7 }, (_, h) => `0${h}:00`)

const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

export const SchedulesContainer = () => {
  const [hours, setHours] = useState<OperatingHour[]>(defaultHours)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // What was last loaded or saved, to tell whether there are unsaved edits
  const [savedHours, setSavedHours] = useState(JSON.stringify(defaultHours))
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  // booking_settings.day_ends_at: the latest a day may close after midnight (the save route checks the real value again)
  const [dayEndsAt, setDayEndsAt] = useState("00:00")
  const [savedDayEndsAt, setSavedDayEndsAt] = useState("00:00")
  const dirty = JSON.stringify(hours) !== savedHours || dayEndsAt !== savedDayEndsAt

  useUnsavedChangesPrompt(dirty)

  useEffect(() => {
    const loadHours = async () => {
      setLoading(true)

      const [{ data, error }, { data: settings }] = await Promise.all([
        fetchOperatingHours(),
        supabase.from("booking_settings").select("day_ends_at").maybeSingle(),
      ])
      const cutoff: string = (settings?.day_ends_at ?? "00:00").slice(0, 5)
      setDayEndsAt(cutoff)
      setSavedDayEndsAt(cutoff)

      if (error) {
        toast.error("Failed to load operating hours. Showing defaults.")
        setLoading(false)
        return
      }

      if (data.length > 0) {
        // Merge DB data on top of defaults so every day is always present
        const merged = defaultHours
          .map((defaultDay) => data.find((d) => d.day_of_week === defaultDay.day_of_week) ?? defaultDay)
          .sort((a, b) => dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week))

        setHours(merged)
        setSavedHours(JSON.stringify(merged))
        // Flag saved times the slots can't use, like 8:30
        const checked = checkWeeklyHours(merged, cutoff)
        if ("error" in checked) setErrorMsg(checked.error)
      }
      // If data is empty, we keep the DEFAULT_HOURS already in state

      setLoading(false)
    }

    loadHours()
  }, [])

  const updateDay = (dayIndex: number, changes: Partial<OperatingHour>) => {
    const newHours = hours.map((hour, i) => (i === dayIndex ? { ...hour, ...changes } : hour))
    setHours(newHours)
    validateHours(newHours)
  }

  const handleToggle = (dayIndex: number) => {
    const current = hours[dayIndex]
    const isOpen = !current.is_open
    // Set default times if turning on and they are empty
    const needsDefaultTimes = isOpen && (!current.open_time || !current.close_time)

    updateDay(dayIndex, {
      is_open: isOpen,
      ...(needsDefaultTimes && { open_time: "08:00", close_time: "22:00" }),
    })
  }

  const handleTimeChange = (dayIndex: number, field: "open_time" | "close_time", value: string) => {
    updateDay(dayIndex, { [field]: value }) /* openTime , 09:00*/
  }

  // Same checks the save route applies
  const validateHours = (currentHours: OperatingHour[], cutoff = dayEndsAt) => {
    const checked = checkWeeklyHours(currentHours, cutoff)
    setErrorMsg("error" in checked ? checked.error : null)
    return !("error" in checked)
  }

  const handleSave = async () => {
    if (!validateHours(hours)) {
      toast.error("Please resolve highlighted schedule errors before saving.")
      return
    }

    // New hours leave existing bookings in place: list the ones that would fall outside before saving
    setSaving(true)
    const { data: conflicts } = await findHoursConflicts(hours)
    setSaving(false)
    if (conflicts.length > 0) {
      const shown = conflicts.slice(0, 8).join("\n")
      const more = conflicts.length > 8 ? `\n…and ${conflicts.length - 8} more` : ""
      setConfirmRequest({
        title: `${conflicts.length} ${conflicts.length === 1 ? "booking falls" : "bookings fall"} outside the new hours`,
        description: `Saving does not cancel them. Contact these players, or cancel from Bookings or Open Play.\n\n${shown}${more}`,
        confirmLabel: "Save anyway",
        onConfirm: save,
      })
      return
    }
    save()
  }

  const save = async () => {
    setSaving(true)
    const { error } = await updateOperatingHours(hours, dayEndsAt)
    if (error) {
      toast.error(error.message || "Failed to save operating hours. Please try again.")
    } else {
      setSavedHours(JSON.stringify(hours))
      setSavedDayEndsAt(dayEndsAt)
      toast.success("Operating hours updated successfully.")
    }
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-6">
      {loading ? (
        <ScheduleSkeleton />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-card border shadow-xs">
            <div className="text-sm">
              <span className="text-muted-foreground">Players see new hours on the booking page as soon as you save.</span>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || !!errorMsg}
              className="shrink-0 gap-2 w-full sm:w-auto font-medium"
            >
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving Schedule..." : "Save Operating Hours"}
            </Button>
          </div>

          <OperatingHoursCard
            hours={hours}
            errorMsg={errorMsg}
            onToggle={handleToggle}
            onTimeChange={handleTimeChange}
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-card border shadow-xs">
            <div className="text-sm">
              <label htmlFor="day-ends-at" className="font-semibold text-foreground">Day ends at</label>
              <p className="text-muted-foreground">
                Hours before this time count as the night before, for prices, closed dates, today&apos;s lists and reports. It is also the latest a day can close and the earliest it can open. Only the owner can change it.
              </p>
            </div>
            <select
              id="day-ends-at"
              className="h-10 shrink-0 rounded-md border border-input bg-background px-3 text-sm font-semibold"
              value={dayEndsAt}
              onChange={(e) => { setDayEndsAt(e.target.value); validateHours(hours, e.target.value) }}
            >
              {DAY_END_OPTIONS.map((t) => <option key={t} value={t}>{formatTime12h(t)}</option>)}
            </select>
          </div>

          <ClosedDatesCard />

          <CourtBlocksCard />

          <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
        </>
      )}
    </div>
  )
}