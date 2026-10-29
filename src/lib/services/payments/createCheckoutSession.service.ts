import { to24h } from "../bookings/checkSlotAvailability.service";

interface CheckoutParams {
    date: Date;
    lines: { courtId: string; timeRange: string }[];
}

export const createCheckoutSession = async ({
    date,
    lines,
}: CheckoutParams): Promise<string> => {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(date);

    const apiLines = lines.map(({ courtId, timeRange }) => {
        const [startStr, endStr] = timeRange.split(" - ");
        return { court_id: courtId, start_time: to24h(startStr.trim()), end_time: to24h(endStr.trim()) };
    });

    const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            booking_date: dateStr,
            lines: apiLines,
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
