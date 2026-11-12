interface CheckoutParams {
    /** The business day being booked (YYYY-MM-DD, Manila) */
    bookingDate: string;
    /** Stored bookings: its after-midnight hours carry the next date */
    lines: { court_id: string; booking_date: string; start_time: string; end_time: string }[];
    playerCount: number;
    discountCode?: string | null;
    /** Only for a guest (anonymous session): saved on their guest profile */
    guest?: { full_name: string; phone: string; email: string } | null;
}

export const createCheckoutSession = async ({ bookingDate, lines, playerCount, discountCode, guest }: CheckoutParams): Promise<string> => {
    const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            booking_date: bookingDate,
            lines,
            player_count: playerCount,
            discount_code: discountCode || undefined,
            guest: guest ?? undefined,
        }),
    });

    const contentType = res.headers.get("content-type");
    let data;
    if (contentType && contentType.includes("application/json")) {
        data = await res.json();
    } else {
        throw new Error("Server returned an invalid response.");
    }

    if (!res.ok) {
        throw new Error(data?.error || "Failed to create checkout session");
    }

    if (data.url) {
        return data.url;
    } else {
        throw new Error("No checkout URL returned");
    }
};
