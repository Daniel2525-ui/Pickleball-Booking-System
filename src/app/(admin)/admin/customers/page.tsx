import CustomersContainer from "@/components/admin/customers/customers-container";

export default function CustomersPage() {
    return (
        <div className="flex flex-col gap-6 p-4 lg:p-8 w-full max-w-7xl mx-auto">
            <header>
                <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    View and manage registered customer profiles and contact details.
                </p>
            </header>
            <CustomersContainer />
        </div>
    )
}
