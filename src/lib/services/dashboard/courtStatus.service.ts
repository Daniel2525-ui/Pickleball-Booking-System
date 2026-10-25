import { fetchCourtsData } from "../courts/courtsData.service";

export const fetchCourtStatus = async () => {
    try {
        const { data: courts, error } = await fetchCourtsData();
        if (error || !courts) throw (error || new Error("Failed to fetch courts"));

        const courtsWithStatus = courts.map((court) => {
            const normalizedStatus = (court.status || "").toLowerCase();
            if (normalizedStatus === "maintenance") {
                return { name: court.name, status: "Maintenance" as const };
            }
            if (normalizedStatus === "closed") {
                return { name: court.name, status: "Closed" as const };
            }
            if (normalizedStatus === "occupied") {
                return { name: court.name, status: "In Use" as const };
            }
            return {
                name: court.name,
                status: "Available" as const,
            };
        });

        return {
            data: { courts: courtsWithStatus },
            error: null,
        };
    } catch (error) {
        console.error("Failed to fetch court status", error);
        return {
            data: null,
            error: error as Error,
        };
    }
};