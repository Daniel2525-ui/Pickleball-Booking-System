export const updateCourt = async (
    id: string,
    name: string,
    status: string,
    maintenance?: { note: string; until: string },
    extras?: { photo_url?: string | null; details?: string }
) => {
    try {
        const res = await fetch("/api/admin/courts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, name, status, maintenance_note: maintenance?.note ?? "", maintenance_until: maintenance?.until ?? "", ...extras }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            return { data: null, error: new Error(body?.error || "Failed to update court.") };
        }
        return { data: body.data, error: null };
    } catch (error) {
        console.error("Failed to update court", error);
        return { data: null, error: error as Error };
    }
};
