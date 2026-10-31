export const verifyGcashPayment = async (
    basketId: string,
    action: "approve" | "reject"
): Promise<{ error: Error | null }> => {
    try {
        const res = await fetch("/api/admin/payments/gcash-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ basketId, action }),
        });
        const body = await res.json().catch(() => null);
        return { error: res.ok ? null : new Error(body?.error || "Verification failed.") };
    } catch (error: unknown) {
        console.error("Failed to verify GCash payment:", error);
        return { error: error instanceof Error ? error : new Error("Network error during verification.") };
    }
};
