/** "10:00 AM - 11:00 AM" slots → "10AM-12PM" for a run of `hours` slots starting at `index`. */
export const compactRange = (slots: string[], index: number, hours: number) => {
    const compact = (t: string) => t.trim().replace(":00", "").replace(" ", "");
    return `${compact(slots[index].split(" - ")[0])}-${compact(slots[index + hours - 1].split(" - ")[1])}`;
};

