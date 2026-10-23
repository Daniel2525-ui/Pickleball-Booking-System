export interface Customer {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    totalBookings?: number;
    created_at: string;
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
