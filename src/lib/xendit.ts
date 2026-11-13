// shortcut: demo-only Xendit test-mode QR Ph client, no refunds or expiry sync; replace with the PayMongo branch for launch
/** True for a Xendit payment request (pr-) or payment (py-) id, as stored in the stripe_* columns. */
export const isXenditId = (id: string | null | undefined) => /^p[ry]-/.test(id ?? "");
export const xenditEnabled = () => Boolean(process.env.XENDIT_SECRET_KEY);

export interface XenditPaymentRequest {
    payment_request_id: string;
    reference_id: string;
    status: string;
    request_amount: number;
    currency: string;
    metadata?: Record<string, string>;
    channel_properties?: { expires_at?: string };
    actions?: { type: string; descriptor: string; value: string }[];
    latest_payment_id?: string;
    latest_payment?: { payment_id?: string; status?: string };
}

export async function xendit<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.xendit.co${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString("base64")}`,
            "api-version": "2024-11-11",
            "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(`Xendit ${path} ${res.status}: ${JSON.stringify(json)}`), { status: res.status });
    return json as T;
}

/** Xendit refused the request for good (bad key, invalid amount): nothing was created, so holds can be released. */
export const xenditRefused = (error: unknown) => {
    const status = (error as { status?: unknown })?.status;
    return typeof status === "number" && status >= 400 && status < 500 && status !== 409 && status !== 429;
};

export const getPaymentRequest = (id: string) =>
    xendit<XenditPaymentRequest>(`/v3/payment_requests/${encodeURIComponent(id)}`);

// The Stripe session fields reconcileCheckoutSession and /api/stripe/verify read, filled from a Xendit payment request
export function toStripeSession(pr: XenditPaymentRequest) {
    const paid = pr.status === "SUCCEEDED";
    return {
        id: pr.payment_request_id,
        metadata: pr.metadata ?? {},
        payment_status: paid ? "paid" : "unpaid",
        // Cleanup releases a hold only on "expired"; a QR still payable reads as uncertain ("complete" but unpaid)
        status: paid || !DEAD.includes(pr.status) ? "complete" : "expired",
        payment_intent: pr.latest_payment_id || pr.latest_payment?.payment_id || pr.payment_request_id,
        currency: pr.currency.toLowerCase(),
        amount_total: Math.round(pr.request_amount * 100),
    } as unknown as import("stripe").Stripe.Checkout.Session;
}
const DEAD = ["EXPIRED", "CANCELED", "FAILED"];
export const xenditAsStripeSession = async (id: string) => toStripeSession(await getPaymentRequest(id));

// Xendit expires a QR Ph code 15 minutes after creating it
export const QR_LIFETIME_MS = 15 * 60 * 1000;
export const qrExpiresAt = (pr: XenditPaymentRequest) =>
    pr.channel_properties?.expires_at ?? new Date(Date.now() + QR_LIFETIME_MS).toISOString();

export const qrString = (pr: XenditPaymentRequest) => pr.actions?.find((a) => a.descriptor === "QR_STRING")?.value ?? null;

/** Stops a QR Ph payment request from being paid (Xendit: POST /v3/payment_requests/{id}/cancel). */
export const cancelPaymentRequest = (id: string) =>
    xendit<XenditPaymentRequest>(`/v3/payment_requests/${encodeURIComponent(id)}/cancel`, {});

/**
 * Before a booking paid by this QR is cancelled: "paid" when the player already paid (the webhook confirms it),
 * "closed" once the QR can no longer be paid. Throws when it is still payable and Xendit would not cancel it,
 * so nobody can pay for a cancelled court.
 */
export async function closeQrPayment(
    id: string,
    api: { get: typeof getPaymentRequest; cancel: typeof cancelPaymentRequest } = { get: getPaymentRequest, cancel: cancelPaymentRequest }
): Promise<"closed" | "paid"> {
    const pr = await api.get(id);
    if (pr.status === "SUCCEEDED") return "paid";
    if (DEAD.includes(pr.status)) return "closed";
    try {
        const after = await api.cancel(id);
        if (after.status === "SUCCEEDED") return "paid";
        if (DEAD.includes(after.status)) return "closed";
    } catch (error) {
        // Paid or expired at the same moment, or Xendit refused: decide on what the QR is now
        const now = await api.get(id);
        if (now.status === "SUCCEEDED") return "paid";
        if (DEAD.includes(now.status)) return "closed";
        throw error;
    }
    const now = await api.get(id);
    if (now.status === "SUCCEEDED") return "paid";
    if (DEAD.includes(now.status)) return "closed";
    throw new Error(`Xendit payment request ${id} is still ${now.status} after cancelling`);
}
