import CourtsContainer from "@/components/admin/courts/courts-container";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function CourtsPage() {
    return (
        <div className="flex flex-col gap-6 p-4 lg:p-8 w-full max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Courts</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Manage your pickleball courts, pricing, and availability.
                    </p>
                </div>
                <Button className="w-full sm:w-auto gap-2">
                    <Plus className="h-4 w-4" />
                    Add Court
                </Button>
            </div>

            <CourtsContainer />
        </div>
    );
}
