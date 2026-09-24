"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Save, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OperatingHoursCard } from "./operating-hours-card"
import { OperatingHour } from "./types"
import { fetchOperatingHours } from "@/lib/services/schedule/fetchOperatingHours.service"
import { updateOperatingHours } from "@/lib/services/schedule/updateOperatingHours.service"

const defaultHours: OperatingHour[] = [
  { day: "Monday", isOpen: true, openTime: "08:00", closeTime: "22:00" },
  { day: "Tuesday", isOpen: true, openTime: "08:00", closeTime: "22:00" },
  { day: "Wednesday", isOpen: true, openTime: "08:00", closeTime: "22:00" },
  { day: "Thursday", isOpen: true, openTime: "08:00", closeTime: "22:00" },
  { day: "Friday", isOpen: true, openTime: "08:00", closeTime: "23:00" },
  { day: "Saturday", isOpen: true, openTime: "07:00", closeTime: "23:00" },
  { day: "Sunday", isOpen: false, openTime: "", closeTime: "" },
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
          .map((defaultDay) => data.find((d) => d.day === defaultDay.day) ?? defaultDay)
          .sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day))

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
    const isOpen = !current.isOpen
    // Set default times if turning on and they are empty
    const needsDefaultTimes = isOpen && (!current.openTime || !current.closeTime)

    updateDay(dayIndex, {
      isOpen,
      ...(needsDefaultTimes && { openTime: "08:00", closeTime: "22:00" }),
    })
  }

  const handleTimeChange = (dayIndex: number, field: "openTime" | "closeTime", value: string) => {
    updateDay(dayIndex, { [field]: value })
  }

  const validateHours = (currentHours: OperatingHour[]) => {
    for (const hour of currentHours) {
      if (hour.isOpen && hour.openTime && hour.closeTime && hour.closeTime <= hour.openTime) {
        setErrorMsg(`${hour.day}: Closing time must be later than opening time.`)
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
        <div className="flex h-48 items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground text-sm">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Fetching operating hours...
        </div>
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