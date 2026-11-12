export const formatTime12h = (timeStr?: string) => {
    if (!timeStr) return "";
    const [hoursStr, minutesStr] = timeStr.split(":");
    let hours = parseInt(hoursStr, 10);
    if (isNaN(hours)) return "";
    const minutes = minutesStr || "00";
    const ampm = hours % 24 >= 12 ? "PM" : "AM"; // 24:00 is midnight, 12:00 AM
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
};
// A YYYY-MM-DD venue date is read at Manila noon so no time zone can shift its day; full timestamps are used as they are
const toDate = (value: string) => new Date(value.includes("T") ? value : `${value}T12:00:00+08:00`);

/** "Fri, Nov 6" for a venue date or timestamp, in Manila time. */
export const formatShortDate = (value: string) =>
    toDate(value).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });

/** "Nov 6, 2026" (with time: "Nov 6, 2026, 5:58 PM") in Manila time, or "—" when missing or invalid. */
export const formatDate = (value?: string | null, withTime = false) => {
    if (!value) return "—";
    const date = toDate(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-US", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        year: "numeric",
        ...(withTime && { hour: "numeric", minute: "2-digit", hour12: true }),
    });
};
