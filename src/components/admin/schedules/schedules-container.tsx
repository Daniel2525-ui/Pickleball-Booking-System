"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Save, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OperatingHoursCard } from "./operating-hours-card"
import { ClosedDatesCard } from "./closed-dates-card"
import { OperatingHour } from "./types"
import { ScheduleSkeleton } from "@/components/skeletons/schedule-skeleton"
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service"
import { updateOperatingHours } from "@/lib/services/schedule/updateOperatingHours.service"
import { checkWeeklyHours } from "@/lib/services/schedule/hoursRules"
import { findHoursConflicts } from "@/lib/services/schedule/hoursConflicts.service"
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog"

const defaultHours: OperatingHour[] = [
  { day_of_week: "Monday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Tuesday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Wednesday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Thursday", is_open: true, open_time: "08:00", close_time: "22:00" },
  { day_of_week: "Friday", is_open: true, open_time: "08:00", close_time: "23:00" },
  { day_of_week: "Saturday", is_open: true, open_time: "07:00", close_time: "23:00" },
  { day_of_week: "Sunday", is_open: false, open_time: "", close_time: "" },
]

const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

export const SchedulesContainer = () => {
  const [hours, setHours] = useState<OperatingHour[]>(defaultHours)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // What was last loaded or saved, to tell whether there are unsaved edits
  const [savedHours, setSavedHours] = useState(JSON.stringify(defaultHours))
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const dirty = JSON.stringify(hours) !== savedHours

  // Reloading or closing the tab with unsaved edits asks first
  // shortcut: in-app links (sidebar) still leave without asking; intercept router navigation if staff lose edits that way
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  useEffect(() => {
    const loadHours = async () => {
      setLoading(true)

      const { data, error } = await fetchOperatingHours()

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
        const checked = checkWeeklyHours(merged)
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
  const validateHours = (currentHours: OperatingHour[]) => {
    const checked = checkWeeklyHours(currentHours)
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
    const { error } = await updateOperatingHours(hours)
    if (error) {
      toast.error(error.message || "Failed to save operating hours. Please try again.")
    } else {
      setSavedHours(JSON.stringify(hours))
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
              <span className="font-semibold text-foreground">Real-Time Sync:</span>
              <span className="text-muted-foreground">
                Updated operating hours immediately reflect on the player booking calendar.
              </span>
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

          <ClosedDatesCard />

          <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
        </>
      )}
    </div>
  )
}