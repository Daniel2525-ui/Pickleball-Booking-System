/** Discount codes at checkout. The database (hold_court_basket) applies them; this mirrors it for the preview. */

export type DiscountKind = "percent" | "fixed";

/** "  summer-10 " → "SUMMER-10"; null unless 3 to 20 letters, digits or dashes. */
export const normaliseCode = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const code = raw.trim().toUpperCase();
    return /^[A-Z0-9-]{3,20}$/.test(code) ? code : null;
};

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Each line's amount after the code: a percent comes off every line (rounded to centavos), a fixed amount is
 * taken from the lines in order until it is used up. No line goes below zero. Must match hold_court_basket.
 */
export const applyDiscount = (amounts: number[], code: { kind: DiscountKind; value: number }): number[] => {
    if (code.kind === "percent") return amounts.map((a) => centavos(Math.max(0, a - centavos((a * code.value) / 100))));
    let left = code.value;
    return amounts.map((a) => {
        const off = Math.min(a, left);
        left = centavos(left - off);
        return centavos(a - off);
    });
};
