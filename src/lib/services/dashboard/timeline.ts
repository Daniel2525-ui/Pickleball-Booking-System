import { windowsForWeekday, type HoursInput } from "../schedule/hoursRules.ts";

const hourOf = (t: string) => Number(t.slice(0, 2));

/**
 * The hours the dashboard timeline spans for a business day: the day's own opening hours (a close after
 * midnight runs past 24), widened to fit any booking outside them. 7 AM to 10 PM when the day is closed.
 */
export function timelineRange(hours: HoursInput[], weekday: string, rows: { booking_date: string; start_time: string; end_time: string }[], today?: string) {
  const own = windowsForWeekday(weekday, hours).find((w) => !w.lateNight);
  const row = hours.find((h) => h.day_of_week === weekday);
  let from = own ? hourOf(own.start) : 7;
  let to = own ? (own.end === "24:00" && row?.close_time ? 24 + hourOf(row.close_time) : hourOf(own.end)) : 22;
  for (const r of rows) {
    const shift = today && r.booking_date > today ? 24 : 0;
    from = Math.min(from, hourOf(r.start_time) + shift);
    to = Math.max(to, (hourOf(r.end_time) || 24) + shift);
  }
  return { from, to: Math.max(to, from + 1) };
}

/** Grid columns (1-based, the label is column 1) for a booking inside the range, or null when outside it. */
export function timelineBlock(b: { booking_date: string; start_time: string; end_time: string }, today: string, range: { from: number; to: number }) {
  const shift = b.booking_date > today ? 24 : 0; // after midnight, still tonight
  const start = hourOf(b.start_time) + shift;
  const end = (hourOf(b.end_time) || 24) + shift;
  const from = Math.max(start, range.from);
  const to = Math.min(end, range.to);
  if (to <= from) return null;
  return { from: from - range.from + 2, to: to - range.from + 2 };
}
