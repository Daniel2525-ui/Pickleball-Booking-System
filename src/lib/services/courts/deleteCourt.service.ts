export const deleteCourt = async (id: string) => {
    try {
        const res = await fetch("/api/admin/courts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            return { error: new Error(body?.error || "Failed to delete court.") };
        }
        return { error: null };
    } catch (error) {
        console.error("Failed to delete court", error);
        return { error: error as Error };
    }
};
