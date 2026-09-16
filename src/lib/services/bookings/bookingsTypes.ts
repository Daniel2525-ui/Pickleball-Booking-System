export interface Booking {
    id: string;
    user_id: string;
    court_id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    total_amount: number;
    created_at: string;
    updated_at: string;
    // Joined fields from other tables
    profiles?: {
        full_name: string;
    };
    courts?: {
        name: string;
    };
}

export interface FetchBookingsFilters {
    search?: string;
    status?: string;
    courtId?: string;
}

export interface CourtOption {
    id: string,
    name: string
}