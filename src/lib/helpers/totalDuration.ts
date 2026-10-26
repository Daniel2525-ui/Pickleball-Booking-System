/**
 * Formats duration between booking start and end time (whole hours).
 */
export const calculateDuration = (start?: string, end?: string): string => {
    if (!start || !end) return "";
    const hours = Math.max(1, parseInt(end.slice(0, 2), 10) - parseInt(start.slice(0, 2), 10));
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
};