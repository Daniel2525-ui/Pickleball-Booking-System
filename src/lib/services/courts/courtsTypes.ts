export interface Court {
    id: string;
    name: string;
    status: string;
    /** Why the court is in maintenance, and when staff expect it back (display only) */
    maintenance_note?: string | null;
    maintenance_until?: string | null;
}
