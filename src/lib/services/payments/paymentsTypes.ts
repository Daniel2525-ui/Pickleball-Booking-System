export interface Payment {
    id: string;
    booking_id: string;
    stripe_session_id: string | null;
    stripe_payment_id: string | null;
    amount: number;
    currency: string;
    status: string;
    paid_at: string | null;
    created_at: string;
    // Joined fields
    bookings?: {
        booking_date: string;
        start_time: string;
        end_time: string;
        profiles?: {
            full_name: string;
        };
        courts?: {
            name: string;
        };
    };
}

export interface FetchPaymentsFilters {
    search?: string;
    status?: string;
}
