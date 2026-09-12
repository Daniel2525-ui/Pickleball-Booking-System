import { BookingFilters, BookingsTable } from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function BookingsPage() {
    return (
        <div className="flex flex-col gap-6 p-4 lg:p-8 w-full max-w-7xl mx-auto">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Bookings</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Manage all your pickleball court reservations.
                    </p>
                </div>
                <Button className="w-full sm:w-auto gap-2">
                    <Plus className="h-4 w-4" />
                    New Booking
                </Button>
            </div>

            {/* Main Content Area */}
            <div className="flex flex-col gap-4 mt-2">
                <BookingFilters />
                <BookingsTable />
            </div>
        </div>
    )
}

