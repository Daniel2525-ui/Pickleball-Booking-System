import CustomersContainer from "@/components/admin/customers/customers-container";
import { AdminPageHeader } from "@/components/admin/page-header";

export default function CustomersPage() {
    return (
        <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-7xl mx-auto">
            <AdminPageHeader title="Customers" description="Everyone who has booked, with their contact details and notes." />
            <CustomersContainer />
        </div>
    )
}
