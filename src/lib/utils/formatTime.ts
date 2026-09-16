// lib/utils/formatTime.ts
export const formatTime12h = (timeStr?: string) => {
    if (!timeStr) return "";
    const [hoursStr, minutesStr] = timeStr.split(":");
    let hours = parseInt(hoursStr, 10);
    if (isNaN(hours)) return "";
    const minutes = minutesStr || "00";
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
};