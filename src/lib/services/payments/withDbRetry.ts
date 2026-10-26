/**
 * Database retry wrapper for Supabase PostgREST client operations.
 *
 * Supabase client does not throw JavaScript exceptions for database errors;
 * it returns { data, error }. This helper inspects error.code for retryable
 * transient database error codes (deadlocks, serialization failures, lock acquisition timeouts)
 * with exponential backoff and jitter.
 */

export interface DbResult<T> {
    data: T | null;
    error: {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
    } | null;
}

const RETRYABLE_PG_CODES = new Set([
    "40P01", // deadlock_detected
    "40001", // serialization_failure
    "55P03", // lock_not_available
]);

export async function withDbRetry<T>(
    operation: () => PromiseLike<DbResult<T>>,
    maxRetries = 2,
    baseDelayMs = 50
): Promise<DbResult<T>> {
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            const result = await operation();

            if (!result.error) {
                return result;
            }

            const code = result.error.code || "";
            if (!RETRYABLE_PG_CODES.has(code) || attempt === maxRetries) {
                return result;
            }

            attempt++;
            const jitter = Math.floor(Math.random() * 25);
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
            await new Promise((r) => setTimeout(r, delay));
        } catch (networkError: unknown) {
            // Network transport or connection error
            if (attempt === maxRetries) {
                throw networkError;
            }
            attempt++;
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    return operation();
}
