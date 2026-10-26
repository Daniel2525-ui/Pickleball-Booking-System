/**
 * Pure countdown calculations and formatting for court reservation holds.
 */

/**
 * Calculates remaining seconds until hold_expires_at, clamped to 0.
 *
 * @param expiresAt ISO date string, Date object, or null/undefined
 * @param now Current time (Date or milliseconds timestamp). Defaults to Date.now()
 * @returns Non-negative integer seconds remaining
 */
export function calculateRemainingSeconds(
    expiresAt: string | Date | null | undefined,
    now: Date | number = Date.now()
): number {
    if (!expiresAt) return 0;

    const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
    if (isNaN(expiryTime)) return 0;

    const currentTime = now instanceof Date ? now.getTime() : now;
    const diffMs = expiryTime - currentTime;

    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / 1000);
}

/**
 * Formats seconds into MM:SS, or HH:MM:SS if >= 3600 seconds.
 * Clamps negative or non-finite seconds to "00:00".
 *
 * @param totalSeconds Number of seconds remaining
 * @returns Formatted time string
 */
export function formatCountdown(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return "00:00";
    }

    const sec = Math.floor(totalSeconds);
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const remainingSec = sec % 60;

    const pad = (n: number) => n.toString().padStart(2, "0");

    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(remainingSec)}`;
    }

    return `${pad(minutes)}:${pad(remainingSec)}`;
}

export interface HoldCountdownState {
    isPending: boolean;
    isExpired: boolean;
    remainingSeconds: number;
    formatted: string;
}

/**
 * Evaluates the full countdown state for a given booking.
 *
 * @param expiresAt Hold expiry timestamp
 * @param status Current booking status
 * @param now Optional timestamp reference
 */
export function getHoldCountdownState(
    expiresAt: string | Date | null | undefined,
    status: string,
    now: Date | number = Date.now()
): HoldCountdownState {
    const isPending = (status || "").toLowerCase() === "pending";

    if (!isPending) {
        return {
            isPending: false,
            isExpired: false,
            remainingSeconds: 0,
            formatted: "00:00",
        };
    }

    const remainingSeconds = calculateRemainingSeconds(expiresAt, now);
    const isExpired = remainingSeconds <= 0;

    return {
        isPending: true,
        isExpired,
        remainingSeconds,
        formatted: formatCountdown(remainingSeconds),
    };
}
