import { OperatingHour } from "./operatingHoursInterface";

const weekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Helper to format 24h string to 12h AM/PM string.
 * Example: "08:00" -> "08:00 AM"
 */
export const formatTime12h = (timeStr: string): string => {
    const [hoursStr, minutesStr] = timeStr.split(":");
    let hours = parseInt(hoursStr, 10);
    if (isNaN(hours)) return "";
    const minutes = minutesStr || "00";
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const formattedHours = hours < 10 ? `0${hours}` : hours.toString();
    return `${formattedHours}:${minutes} ${ampm}`;
};

/**
 * Generates an array of time slot strings (e.g. "08:00 AM - 09:00 AM")
 * for a given date based on operating hours.
 */
export const generateTimeSlots = (selectedDate: Date, operatingHours: OperatingHour[]): string[] => {
    if (!operatingHours || !operatingHours.length) return [];

    const dayName = weekDays[selectedDate.getDay()];
    const todaySchedule = operatingHours.find((hour) => hour.day === dayName);

    if (!todaySchedule || !todaySchedule.isOpen || !todaySchedule.openTime || !todaySchedule.closeTime) {
        return [];
    }

    const openHour = parseInt(todaySchedule.openTime.split(":")[0], 10);
    const closeHour = parseInt(todaySchedule.closeTime.split(":")[0], 10);

    const slots = [];
    for (let i = openHour; i < closeHour; i++) {
        const start = formatTime12h(`${i < 10 ? "0" : ""}${i}:00`);
        const end = formatTime12h(`${i + 1 < 10 ? "0" : ""}${i + 1}:00`);
        slots.push(`${start} - ${end}`);
    }
    return slots;
};
