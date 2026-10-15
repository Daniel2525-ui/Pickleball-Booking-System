import BookingsContainer from "@/components/admin/bookings/bookings-container";

export default function BookingsPage() {
    return (
        <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-7xl mx-auto">
            <BookingsContainer />
        </div>
    );
}
