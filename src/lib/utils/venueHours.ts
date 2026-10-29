import type { OperatingHour } from "@/components/admin/schedules/types";
import { formatTime12h } from "./formatTime.ts";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// "08:00" -> "8 AM", "08:30" -> "8:30 AM"
const hourLabel = (time: string) => formatTime12h(time).replace(":00 ", " ");

export interface VenueHoursSummary {
    /** Earliest opening to latest closing across open days, e.g. "7 AM – 11 PM" */
    range: string;
    note: string;
    /** Consecutive days sharing the same hours, e.g. { days: "Mon–Thu", hours: "8 AM – 10 PM" } */
    groups: { days: string; hours: string }[];
}

/** Summarizes the admin-managed weekly schedule for public display. Null when no day is open. */
export const summarizeVenueHours = (rows: OperatingHour[]): VenueHoursSummary | null => {
    const week = DAYS.map((day) => {
        const row = rows.find((r) => r.day_of_week === day);
        const open = !!(row?.is_open && row.open_time && row.close_time);
        return {
            day,
            open,
            openTime: open ? row!.open_time.slice(0, 5) : "",
            closeTime: open ? row!.close_time.slice(0, 5) : "",
            hours: open ? `${hourLabel(row!.open_time)} – ${hourLabel(row!.close_time)}` : "Closed",
        };
    });

    const openDays = week.filter((d) => d.open);
    if (openDays.length === 0) return null;

    const earliest = openDays.map((d) => d.openTime).sort()[0];
    const latest = openDays.map((d) => d.closeTime).sort().at(-1)!;

    const groups: { from: string; to: string; hours: string }[] = [];
    for (const d of week) {
        const last = groups.at(-1);
        if (last && last.hours === d.hours) last.to = d.day;
        else groups.push({ from: d.day, to: d.day, hours: d.hours });
    }

    const note =
        groups.length === 1 ? "Open 7 days a week"
            : openDays.length === 7 ? "Open daily · hours vary by day"
                : `Open ${openDays.length} days a week`;

    return {
        range: `${hourLabel(earliest)} – ${hourLabel(latest)}`,
        note,
        groups: groups.map((g) => ({
            days: g.from === g.to ? g.from.slice(0, 3) : `${g.from.slice(0, 3)}–${g.to.slice(0, 3)}`,
            hours: g.hours,
        })),
    };
};
