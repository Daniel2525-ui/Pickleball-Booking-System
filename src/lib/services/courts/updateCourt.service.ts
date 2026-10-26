export const updateCourt = async (id: string, name: string, status: string) => {
    try {
        const res = await fetch("/api/admin/courts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, name, status }),
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
