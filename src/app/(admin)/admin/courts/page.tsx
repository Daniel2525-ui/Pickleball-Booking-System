import CourtsContainer from "@/components/admin/courts/courts-container";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function CourtsPage() {
    return (
        <div className="flex flex-col gap-6 p-4 lg:p-8 w-full max-w-7xl mx-auto">
            <CourtsContainer />
        </div>
    );
}
