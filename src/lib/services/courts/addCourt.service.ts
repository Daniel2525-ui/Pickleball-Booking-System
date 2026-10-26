export const addCourt = async (name: string, status: string) => {
    try {
        const res = await fetch("/api/admin/courts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, status }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            return { data: null, error: new Error(body?.error || "Failed to add court.") };
        }
        return { data: body.data, error: null };
    } catch (error) {
        console.error("Failed to add court", error);
        return { data: null, error: error as Error };
    }
};
