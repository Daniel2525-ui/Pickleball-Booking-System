/** "10:00 AM - 11:00 AM" slots → "10AM-12PM" for a run of `hours` slots starting at `index`. */
export const compactRange = (slots: string[], index: number, hours: number) => {
    const compact = (t: string) => t.trim().replace(":00", "").replace(" ", "");
    return `${compact(slots[index].split(" - ")[0])}-${compact(slots[index + hours - 1].split(" - ")[1])}`;
};


/** "8:00 AM - 9:00 AM" → "8–9 AM"; across noon or midnight both sides keep their AM/PM: "11 AM–12 PM". */
export const hourRangeLabel = (slot: string) => {
    const [start, end] = slot.split(" - ").map((t) => t.trim().replace(":00", ""));
    const [sh, sm] = start.split(" ");
    const [eh, em] = end.split(" ");
    return sm === em ? `${sh}–${eh} ${em}` : `${start}–${end}`;
};
