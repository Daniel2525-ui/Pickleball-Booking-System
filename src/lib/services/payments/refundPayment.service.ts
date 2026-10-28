export type RefundStatus = "refunded" | "queued";

export const refundPayment = async (
    paymentId: string,
    receiptReference?: string
): Promise<{ status: RefundStatus | null; error: Error | null }> => {
    try {
        const res = await fetch("/api/admin/payments/refund", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId, receiptReference: receiptReference?.trim() || null }),
        });

        const body = await res.json().catch(() => null);

        if (!res.ok) {
            return { status: null, error: new Error(body?.error || "Failed to refund payment.") };
        }

        return { status: body?.status as RefundStatus, error: null };
    } catch (error: unknown) {
        console.error("Failed to refund payment:", error);
        return { status: null, error: new Error("Network error while refunding the payment.") };
    }
};
