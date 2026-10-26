import { OperatingHour } from "@/components/admin/schedules/types";

export const updateOperatingHours = async (hours: OperatingHour[]) => {
    try {
        const res = await fetch("/api/admin/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hours }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            return { data: null, error: new Error(body?.error || "Failed to update operating hours.") };
        }
        return { data: body.data, error: null };
    } catch (error) {
        console.error("Failed to update operating hours:", error);
        return { data: null, error: error as Error };
    }
};
