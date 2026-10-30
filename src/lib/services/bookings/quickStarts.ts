/** Pure helpers for the quick booking picker: which start times fit N courts for H hours. */

export type QuickStart = { index: number; slot: string; freeCourts: string[] };

/** "10:00 AM - 11:00 AM" slots → "10AM-12PM" for a run of `hours` slots starting at `index`. */
export const compactRange = (slots: string[], index: number, hours: number) => {
    const compact = (t: string) => t.trim().replace(":00", "").replace(" ", "");
    return `${compact(slots[index].split(" - ")[0])}-${compact(slots[index + hours - 1].split(" - ")[1])}`;
};

/** Every start slot with the courts free for all `hours` from it; `isFree(court, slot)` is the grid's availability check. */
export const quickStarts = (
    slots: string[],
    courts: string[],
    hours: number,
    isFree: (court: string, slot: string) => boolean,
): QuickStart[] =>
    slots.slice(0, Math.max(0, slots.length - hours + 1)).map((slot, index) => ({
        index,
        slot,
        freeCourts: courts.filter((court) => slots.slice(index, index + hours).every((s) => isFree(court, s))),
    }));

/** Keep the customer's chosen courts that are still free, then fill up to `wanted` from the free list in order. */
export const pickCourts = (free: string[], chosen: string[], wanted: number) => {
    const kept = chosen.filter((c) => free.includes(c)).slice(0, wanted);
    return [...kept, ...free.filter((c) => !kept.includes(c)).slice(0, wanted - kept.length)];
};
