import { supabase } from "@/lib/supabase";
import type { TransactionRow, VenueReport } from "./reports";
import { venueDayWindow, paymentMethodLabel, DONE_REFUND_STATUSES } from "@/lib/services/payments/paymentsTypes";
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";
import { bookingRef, bookingTitle } from "@/lib/services/openPlay/bookingTitle";

/** The whole report for a period (from = null for all time). Admins only; anyone else gets the error text. */
export async function fetchVenueReport(from: string | null, to: string): Promise<{ data: VenueReport | null; error: string | null }> {
    const { data, error } = await supabase.rpc("get_venue_report", { p_from: from, p_to: to });
    if (error) {
        console.error("Failed to load the report:", error);
        return { data: null, error: "Could not load the report. Please try again." };
    }
    return { data: data as VenueReport, error: null };
}

const BOOKING_FIELDS = "id, basket_id, customer_name, open_play_spots, profiles(full_name), courts(name)";
type BookingBits = { id: string; basket_id: string | null; customer_name: string | null; open_play_spots: number | null; profiles: { full_name: string } | null; courts: { name: string } | null } | null;

const manilaTime = (iso: string) =>
    new Date(iso).toLocaleString("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");

/** Every page of a query (PostgREST returns at most 1000 rows per request). */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await page(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < 1000) return rows;
    }
}

/**
 * Payments taken and refunds completed between two business days (inclusive), oldest first: the same days and
 * rule the report's money uses, one line per movement.
 */
export async function fetchTransactions(from: string, to: string): Promise<{ data: TransactionRow[] | null; error: string | null }> {
    try {
        const dayEndsAt = (await fetchBookingPolicy(supabase)).dayEndsAt;
        const start = venueDayWindow(from, dayEndsAt).start;
        const end = venueDayWindow(to, dayEndsAt).end;
        const [paid, refunds] = await Promise.all([
            allPages((a, b) => supabase.from("payments")
                .select(`id, amount, payment_method, payment_reference, stripe_payment_id, status, paid_at, bookings(${BOOKING_FIELDS})`)
                .in("status", ["paid", "refunded"]).gte("paid_at", start).lt("paid_at", end).order("paid_at").range(a, b)),
            allPages((a, b) => supabase.from("refund_requests")
                .select(`amount, receipt_reference, stripe_refund_id, processed_at, payments(payment_method, status, bookings(${BOOKING_FIELDS}))`)
                .in("status", DONE_REFUND_STATUSES).gte("processed_at", start).lt("processed_at", end).order("processed_at").range(a, b)),
        ]);
        const describe = (b: BookingBits) => ({
            customer: b?.profiles?.full_name || b?.customer_name || "Customer",
            ref: b ? bookingRef(b) : "",
            item: b ? bookingTitle(b) : "",
        });
        const rows: TransactionRow[] = [
            ...paid.map((p) => {
                const pay = p as unknown as { amount: number; payment_method: string | null; payment_reference: string | null; stripe_payment_id: string | null; status: string; paid_at: string; bookings: BookingBits };
                return {
                    at: manilaTime(pay.paid_at), kind: "Payment" as const, ...describe(pay.bookings),
                    method: paymentMethodLabel({ status: "paid", payment_method: pay.payment_method }),
                    amount: Number(pay.amount), reference: pay.payment_reference || pay.stripe_payment_id || "",
                };
            }),
            ...refunds.map((r) => {
                const ref = r as unknown as { amount: number; receipt_reference: string | null; stripe_refund_id: string | null; processed_at: string; payments: { payment_method: string | null; bookings: BookingBits } | null };
                return {
                    at: manilaTime(ref.processed_at), kind: "Refund" as const, ...describe(ref.payments?.bookings ?? null),
                    method: paymentMethodLabel({ status: "paid", payment_method: ref.payments?.payment_method ?? null }),
                    // Stored as xendit:<ref>#<payment id> for QR Ph; the accountant needs the Xendit part
                    amount: -Number(ref.amount), reference: ref.receipt_reference || (ref.stripe_refund_id ?? "").replace(/^xendit:/, "").replace(/#.*$/, ""),
                };
            }),
        ].sort((a, b) => a.at.localeCompare(b.at));
        return { data: rows, error: null };
    } catch (error) {
        console.error("Failed to load transactions:", error);
        return { data: null, error: "Could not load the transactions. Please try again." };
    }
}
