export interface Customer {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    created_at: string;
    /** registered = online member account, walk_in = record created at the desk */
    type: "registered" | "walk_in";
    bookings_count: number;
    last_visit: string | null;
    no_shows: number;
    total_spent: number;
}

export interface UnifiedCustomerResult {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    type: 'registered' | 'walk_in';
}

export interface CreateWalkInCustomerInput {
    fullName: string;
    phone?: string;
    email?: string;
}
