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
    /** null on an open play spot row */
    court_id: string | null;
    open_play_session_id?: string | null;
    /** Spots bought on a spot row; null on court bookings and on the court-reserving block rows */
    open_play_spots?: number | null;
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
    /** Shared by the courts of one checkout; null for legacy single-court bookings */
    basket_id?: string | null;
    /** Why a cancelled booking was cancelled (bookings_cancel_reason_check); null when unknown */
    cancel_reason?: string | null;

    profiles?: {
        full_name: string;
        phone?: string | null;
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
    /** Courts booked in the same checkout (fetchBookings); 1 for a single-court booking */
    basket_size?: number;
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