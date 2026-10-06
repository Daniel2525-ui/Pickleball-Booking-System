"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Save, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OperatingHoursCard } from "./operating-hours-card"
import { OperatingHour } from "./types"
import { ScheduleSkeleton } from "@/components/skeletons/schedule-skeleton"
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service"
import { updateOperatingHours } from "@/lib/services/schedule/updateOperatingHours.service"

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
    updateDay(dayIndex, { [field]: value })
  }

  const validateHours = (currentHours: OperatingHour[]) => {
    for (const hour of currentHours) {
      if (hour.is_open && hour.open_time && hour.close_time && hour.close_time <= hour.open_time) {
        setErrorMsg(`${hour.day_of_week}: Closing time must be later than opening time.`)
        return false
      }
    }
    setErrorMsg(null)
    return true
  }

  const handleSave = async () => {
    if (!validateHours(hours)) {
      toast.error("Please fix the validation errors before saving.")
      return
    }

    setSaving(true)

    const { error } = await updateOperatingHours(hours)

    if (error) {
      toast.error("Failed to save operating hours. Please try again.")
    } else {
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <Button onClick={handleSave} disabled={saving} className="shrink-0 gap-2">
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>

          <OperatingHoursCard
            hours={hours}
            errorMsg={errorMsg}
            onToggle={handleToggle}
            onTimeChange={handleTimeChange}
          />
        </>
      )}
    </div>
  )
}