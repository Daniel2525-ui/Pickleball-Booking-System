/** Checkout details for a player paying without an account, and the number-of-players rule for every checkout. */

export interface GuestDetails {
    full_name: string;
    /** Philippine mobile number as 09XXXXXXXXX */
    phone: string;
    email: string;
}

/** 0917…, +63 917… and 63917… all become 09171234567; anything else is not a PH mobile number. */
const mobileOf = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const local = digits.startsWith("63") ? `0${digits.slice(2)}` : digits;
    return /^09\d{9}$/.test(local) ? local : null;
};

export const parseGuestDetails = (input: unknown): { ok: true; value: GuestDetails } | { ok: false; error: string } => {
    const { full_name, phone, email } = (input ?? {}) as Record<string, unknown>;
    if (typeof full_name !== "string" || typeof phone !== "string" || typeof email !== "string") {
        return { ok: false, error: "Enter your name, mobile number and email." };
    }
    const name = full_name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 100) return { ok: false, error: "Enter your full name (2 to 100 characters)." };
    const mobile = mobileOf(phone);
    if (!mobile) return { ok: false, error: "Enter a Philippine mobile number, like 0917 123 4567." };
    const mail = email.trim().toLowerCase();
    if (mail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, error: "Enter a valid email address." };
    return { ok: true, value: { full_name: name, phone: mobile, email: mail } };
};

/** The most players a checkout can list: the venue's per-court limit times its courts (at least one court). */
export const maxPlayers = (perCourt: number, courtCount: number) => perCourt * Math.max(1, courtCount);

/** Null when the count is fine, otherwise the message to show. Must match hold_court_basket's check. */
export const checkPlayerCount = (n: unknown, max: number): string | null => {
    if (typeof n !== "number" || Number.isNaN(n)) return "Enter the number of players.";
    if (!Number.isInteger(n)) return "The number of players must be a whole number.";
    if (n < 1) return "Bookings need at least 1 player.";
    if (n > max) return `This booking takes at most ${max} players.`;
    return null;
};
