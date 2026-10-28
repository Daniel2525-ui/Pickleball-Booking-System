import { createHash, timingSafeEqual } from "node:crypto";

/** Checks `Authorization: Bearer <secret>` in constant time; always false when the secret is unset. */
export const isAuthorizedCronRequest = (authHeader: string | null, secret: string | undefined): boolean => {
    if (!secret || !authHeader) return false;
    // Hashing makes both sides the same length, so timing reveals nothing about the secret
    const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
    const actual = createHash("sha256").update(authHeader).digest();
    return timingSafeEqual(expected, actual);
};
