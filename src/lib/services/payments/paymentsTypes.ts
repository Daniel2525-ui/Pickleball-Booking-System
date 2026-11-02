export interface Payment {
    id: string;
    booking_id: string;
    stripe_session_id: string | null;
    stripe_payment_id: string | null;
    amount: number;
    currency: string;
    status: string;
    payment_method?: string | null;
    payment_reference?: string | null;
    gcash_proof_path?: string | null;
    paid_at: string | null;
    created_at: string;
    // Refund ledger rows for this payment (admins only, newest decides what Refund Owed says)
    refund_requests?: { status: string; created_at: string }[] | null;
    // Joined fields
    bookings?: {
        status?: string;
        booking_date: string;
        start_time: string;
        end_time: string;
        customer_name?: string;
        open_play_spots?: number | null;
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
