export const calculateDuration = (start: string, end: string) => {
    if (!start || !end) return "";

    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);

    const diffMinutes =
        endH * 60 + endM - (startH * 60 + startM);

    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;

    if (hours > 0 && mins > 0) {
        return `${hours} hr ${mins} min`;
    }

    if (hours > 0) {
        return `${hours} hour${hours > 1 ? "s" : ""}`;
    }

    return `${mins} min`;
};