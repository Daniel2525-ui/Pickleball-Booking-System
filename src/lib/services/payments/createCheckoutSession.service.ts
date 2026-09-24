import { to24h } from "../bookings/checkSlotAvailability.service";

interface CheckoutParams {
    courtId: string;
    courtName: string;
    date: Date;
    timeRange: string;
}

export const createCheckoutSession = async ({
    courtId,
    courtName,
    date,
    timeRange,
}: CheckoutParams): Promise<string> => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    const [startStr, endStr] = timeRange.split(" - ");
    const startTime24 = to24h(startStr.trim());
    const endTime24 = to24h(endStr.trim());

    const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            court_id: courtId,
            court_name: courtName,
            booking_date: dateStr,
            start_time: startTime24,
            end_time: endTime24,
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
