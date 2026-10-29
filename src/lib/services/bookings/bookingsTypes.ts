export interface BookingPayment {
    id: string;
    status: string;
    payment_method?: string | null;
    payment_reference?: string | null;
    amount?: number;
}

export interface Booking {
    id: string;
    user_id?: string | null;
    customer_id?: string | null;
    customer_name: string;
    court_id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    total_amount: number;
    created_at: string;
    updated_at: string;

    // Stage 2 game-day audit timestamps
    checked_in_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    no_show_at?: string | null;

    hold_expires_at?: string | null;
    /** Why a cancelled booking was cancelled (bookings_cancel_reason_check); null when unknown */
    cancel_reason?: string | null;

    profiles?: {
        full_name: string;
    } | null;
    customers?: {
        full_name: string;
        phone?: string | null;
        email?: string | null;
    } | null;
    courts?: {
        name: string;
    } | null;
    payments?: BookingPayment | BookingPayment[] | null;
}

export interface FetchBookingsFilters {
    search?: string;
    status?: string;
    courtId?: string;
    dateTime?: string;
}

export interface CourtOption {
    id: string,
    name: string
}