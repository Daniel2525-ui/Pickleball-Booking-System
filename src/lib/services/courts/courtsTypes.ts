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
