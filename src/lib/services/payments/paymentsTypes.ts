export interface Payment {
    id: string;
    booking_id: string;
    stripe_session_id: string | null;
    stripe_payment_id: string | null;
    amount: number;
    currency: string;
    status: string;
    payment_method?: string | null;
    payment_reference?: string | null;
    paid_at: string | null;
    created_at: string;
    // Refund ledger rows for this payment (admins only, newest decides the refund note)
    refund_requests?: { status: string; created_at: string }[] | null;
    // Joined fields
    bookings?: {
        basket_id?: string | null;
        status?: string;
        cancel_reason?: string | null;
        booking_date: string;
        start_time: string;
        end_time: string;
        customer_name?: string;
        open_play_spots?: number | null;
        open_play_session_id?: string | null;
        court_id?: string | null;
        hold_expires_at?: string | null;
        created_at?: string;
        profiles?: {
            full_name: string;
        };
        courts?: {
            name: string;
        };
    };
}

export interface FetchPaymentsFilters {
    search?: string;
    status?: string;
    /** YYYY-MM-DD venue date the money came in (paid_at, or created_at while unpaid); empty for every date */
    date?: string;
}

/** How a payment was made, as staff say it: "Cash", "QR Ph", or "Not paid yet". */
export const paymentMethodLabel = (p: { status: string; payment_method?: string | null; payment_reference?: string | null }) => {
    if (p.status === "pending") return "Not paid yet";
    if (p.payment_method === "cash") return "Cash";
    if (p.payment_method === "gcash") return "QR Ph"; // front desk QR Ph; its Xendit id stays searchable but is not shown
    return "QR Ph"; // 'stripe', or null on older online payments
};

/** Payment badge text on a booking row. A paid payment on a cancelled booking is money still held: kept, or not refunded yet. */
export const bookingPaymentLabel = (
    booking: { status: string; cancel_reason?: string | null },
    p: { status: string; payment_method?: string | null }
) => {
    if (p.status === "pending") return "Unpaid";
    if (p.status !== "paid") return p.status;
    if (booking.status !== "cancelled") return `Paid • ${paymentMethodLabel(p)}`;
    return booking.cancel_reason === "payment_kept" ? "Payment kept" : "Refund owed";
};

/** UTC instants bounding one venue day (Asia/Manila, UTC+8, no DST), from dayEndsAt to dayEndsAt for a business day. */
export const venueDayWindow = (date: string, dayEndsAt = "00:00") => {
    const start = new Date(`${date}T${dayEndsAt.slice(0, 5)}:00+08:00`);
    return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
};

type MoneyRow = { amount: number | string | null; payment_method?: string | null };

/**
 * One day's money, the way the drawer sees it. `paid`: payments paid that day (a later refund doesn't undo the
 * money coming in). `refunds`: refunds completed that day, whenever their payment was taken.
 */
export const sumPayments = (paid: (MoneyRow & { status: string })[], refunds: MoneyRow[] = []) => {
    const totals = { collected: 0, cash: 0, gcash: 0, card: 0, collectedCount: 0, refunded: 0, refundedCount: 0, refundedCash: 0 };
    for (const r of paid) {
        if (r.status !== "paid" && r.status !== "refunded") continue;
        const amount = Number(r.amount) || 0;
        totals.collected += amount;
        totals.collectedCount++;
        if (r.payment_method === "cash") totals.cash += amount;
        else if (r.payment_method === "gcash") totals.gcash += amount;
        else totals.card += amount;
    }
    for (const r of refunds) {
        const amount = Number(r.amount) || 0;
        totals.refunded += amount;
        totals.refundedCount++;
        if (r.payment_method === "cash") totals.refundedCash += amount;
    }
    return totals;
};

/** refund_requests statuses for money actually returned: card refunds and recorded cash / front-desk QR Ph handbacks */
export const DONE_REFUND_STATUSES = ["succeeded", "cash_refunded"];
