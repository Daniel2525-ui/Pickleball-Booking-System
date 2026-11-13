/**
 * Formats duration between booking start and end time (whole hours).
 * An end at or before the start runs past midnight (22:00 - 01:00 is 3 hours).
 */
export const calculateDuration = (start?: string, end?: string): string => {
    if (!start || !end) return "";
    const hours = (parseInt(end.slice(0, 2), 10) - parseInt(start.slice(0, 2), 10) + 24) % 24 || 1;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
};
