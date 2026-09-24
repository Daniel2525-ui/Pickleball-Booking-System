import BookingsContainer from "@/components/admin/bookings/bookings-container";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function BookingsPage() {
    return (
        <div className="flex flex-col gap-6 p-4 lg:p-8 w-full max-w-7xl mx-auto">
            <BookingsContainer />
        </div>
    );
}
