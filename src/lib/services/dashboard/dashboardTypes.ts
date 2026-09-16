export interface DayData {
    day: string,
    shortDay: string,
    bookings: number;
}

export interface RecentBooking {
    id: string;
    customer: string;
    court: string;
    dateTime: string;
    amount: string;
    status: "Confirmed" | "Pending" | "Cancelled";
}