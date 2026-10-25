export interface SettleCounterPaymentParams {
    paymentId: string;
    bookingId: string;
    paymentMethod: "cash" | "gcash";
    paymentReference?: string;
}

export const settleCounterPayment = async ({
    paymentId,
    bookingId,
    paymentMethod,
    paymentReference,
}: SettleCounterPaymentParams): Promise<{ success: boolean; data: Record<string, unknown> | null; error: Error | null }> => {
    try {
        if (!paymentId || !bookingId || !paymentMethod) {
            return {
                success: false,
                data: null,
                error: new Error("Missing required payment settlement parameters."),
            };
        }

        const res = await fetch("/api/admin/payments/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                paymentId,
                bookingId,
                paymentMethod,
                paymentReference: paymentReference?.trim() || null,
            }),
        });

        const body = await res.json().catch(() => null);

        if (!res.ok) {
            return {
                success: false,
                data: null,
                error: new Error(body?.error || "Failed to settle payment."),
            };
        }

        return {
            success: true,
            data: (body?.data as Record<string, unknown>) || null,
            error: null,
        };
    } catch (error: unknown) {
        console.error("Failed to settle counter payment:", error);
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error : new Error("Network error during payment settlement."),
        };
    }
};
