/** Discount codes at checkout. The database (hold_court_basket) applies them; this mirrors it for the preview. */

export type DiscountKind = "percent" | "fixed";

/** "  summer-10 " → "SUMMER-10"; null unless 3 to 20 letters, digits or dashes. */
export const normaliseCode = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const code = raw.trim().toUpperCase();
    return /^[A-Z0-9-]{3,20}$/.test(code) ? code : null;
};

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Every court in a checkout is charged at least this; a payment of ₱0 could not be recorded. */
export const MIN_LINE_AMOUNT = 1;

/**
 * Each line's amount after the code: a percent comes off every line (rounded to centavos), a fixed amount is
 * taken from the lines in order until it is used up, each line keeping MIN_LINE_AMOUNT. Null when a fixed code is
 * worth more than the booking can give (the code is refused, never part-applied). Must match hold_court_basket.
 */
export const applyDiscount = (amounts: number[], code: { kind: DiscountKind; value: number }): number[] | null => {
    if (code.kind === "percent") return amounts.map((a) => centavos(Math.max(MIN_LINE_AMOUNT, a - centavos((a * code.value) / 100))));
    let left = code.value;
    const out = amounts.map((a) => {
        const off = Math.min(Math.max(0, a - MIN_LINE_AMOUNT), left);
        left = centavos(left - off);
        return centavos(a - off);
    });
    return left > 0 ? null : out;
};

export interface DiscountInput {
    code: string;
    kind: DiscountKind;
    value: number;
    starts_on: string | null;
    ends_on: string | null;
    max_uses: number | null;
}

const dateOrNull = (raw: unknown): string | null | false => {
    if (raw === null || raw === undefined || raw === "") return null;
    return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : false;
};

/** The owner's new or edited code, checked the way the discount_codes table does. */
export const parseDiscountInput = (input: unknown): { ok: true; value: DiscountInput } | { ok: false; error: string } => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const code = normaliseCode(raw.code);
    if (!code) return { ok: false, error: "A code is 3 to 20 letters, numbers or dashes." };
    if (raw.kind !== "percent" && raw.kind !== "fixed") return { ok: false, error: "Choose a percent or a peso amount off." };
    const value = Number(raw.value);
    if (raw.kind === "percent" && !(Number.isFinite(value) && value >= 1 && value <= 90)) {
        return { ok: false, error: "A percent off is 1 to 90." };
    }
    if (raw.kind === "fixed" && !(Number.isFinite(value) && value > 0 && value <= 100000)) {
        return { ok: false, error: "A peso amount off must be more than ₱0." };
    }
    const starts_on = dateOrNull(raw.starts_on);
    const ends_on = dateOrNull(raw.ends_on);
    if (starts_on === false || ends_on === false) return { ok: false, error: "Enter dates as YYYY-MM-DD." };
    if (starts_on && ends_on && ends_on < starts_on) return { ok: false, error: "The code must end after it starts." };
    const maxRaw = raw.max_uses;
    const max_uses = maxRaw === null || maxRaw === undefined || maxRaw === "" ? null : Number(maxRaw);
    if (max_uses !== null && !(Number.isInteger(max_uses) && max_uses > 0)) {
        return { ok: false, error: "The most uses must be a whole number above 0, or left empty for no limit." };
    }
    return { ok: true, value: { code, kind: raw.kind, value: Math.round(value * 100) / 100, starts_on, ends_on, max_uses } };
};
