// shortcut: demo-only Xendit test-mode QR Ph client, no refunds or expiry sync; replace with the PayMongo branch for launch
export const xenditEnabled = () => Boolean(process.env.XENDIT_SECRET_KEY);

export interface XenditPaymentRequest {
    payment_request_id: string;
    reference_id: string;
    status: string;
    request_amount: number;
    currency: string;
    metadata?: Record<string, string>;
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
    if (!res.ok) throw new Error(`Xendit ${path} ${res.status}: ${JSON.stringify(json)}`);
    return json as T;
}

export const getPaymentRequest = (id: string) =>
    xendit<XenditPaymentRequest>(`/v3/payment_requests/${encodeURIComponent(id)}`);

// The Stripe session fields reconcileCheckoutSession and /api/stripe/verify read, filled from a Xendit payment request
export async function xenditAsStripeSession(id: string) {
    const pr = await getPaymentRequest(id);
    return {
        id: pr.payment_request_id,
        metadata: pr.metadata ?? {},
        payment_status: pr.status === "SUCCEEDED" ? "paid" : "unpaid",
        payment_intent: pr.latest_payment_id || pr.latest_payment?.payment_id || pr.payment_request_id,
        currency: pr.currency.toLowerCase(),
        amount_total: Math.round(pr.request_amount * 100),
    } as unknown as import("stripe").Stripe.Checkout.Session;
}

export const qrString = (pr: XenditPaymentRequest) => pr.actions?.find((a) => a.descriptor === "QR_STRING")?.value ?? null;
