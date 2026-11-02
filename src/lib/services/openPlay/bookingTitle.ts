/** Customer-facing name of a booking: its court, or "Open play · N spots" for a session spot row. */
export function bookingTitle(b: { courts?: { name?: string } | null; open_play_spots?: number | null }): string {
    if (b.open_play_spots) return `Open play · ${b.open_play_spots} ${b.open_play_spots === 1 ? "spot" : "spots"}`;
    return b.courts?.name || "Court";
}
