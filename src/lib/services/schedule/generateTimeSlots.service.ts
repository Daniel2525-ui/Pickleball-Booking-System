import type { OperatingHour } from "@/components/admin/schedules/types";
import { formatTime12h } from "@/lib/utils/formatTime";


/*
 * Generates an array of time slot strings (e.g. "08:00 AM - 09:00 AM")
 * for a given date based on operating hours.
 */
export const generateTimeSlots = (selectedDate: Date, operatingHours: OperatingHour[]): string[] => {
    if (!operatingHours || !operatingHours.length) return [];

    const dayName = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: "Asia/Manila",
    }).format(selectedDate);
    const todaySchedule = operatingHours.find((hour) => hour.day_of_week === dayName);

    if (!todaySchedule || !todaySchedule.is_open || !todaySchedule.open_time || !todaySchedule.close_time) {
        return [];
    }

    const openHour = parseInt(todaySchedule.open_time.split(":")[0], 10);
    const closeHour = parseInt(todaySchedule.close_time.split(":")[0], 10);

    const slots = [];
    for (let i = openHour; i < closeHour; i++) {
        const start = formatTime12h(`${i < 10 ? "0" : ""}${i}:00`);
        const end = formatTime12h(`${i + 1 < 10 ? "0" : ""}${i + 1}:00`);
        slots.push(`${start} - ${end}`);
    }
    return slots;
};
