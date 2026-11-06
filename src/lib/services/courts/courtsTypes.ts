/** The statuses staff pick in Add Court and Edit Court, with their labels */
export const COURT_STATUS_LABELS: Record<string, string> = {
    active: "Available (Open for bookings)",
    maintenance: "Maintenance (Temporarily closed)",
};

export interface Court {
    id: string;
    name: string;
    status: string;
    /** Why the court is in maintenance, and when staff expect it back (display only) */
    maintenance_note?: string | null;
    maintenance_until?: string | null;
    /** Shown on the landing page: a photo in the court-photos bucket, and one line of details */
    photo_url?: string | null;
    details?: string | null;
}
