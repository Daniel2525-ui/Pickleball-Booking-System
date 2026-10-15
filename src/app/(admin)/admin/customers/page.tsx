import CustomersContainer from "@/components/admin/customers/customers-container";

export default function CustomersPage() {
    return (
        <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-7xl mx-auto">
            <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md pt-6 pb-4 sm:pt-7 sm:pb-4 border-b border-border/60 -mx-4 px-4 lg:-mx-8 lg:px-8">
                <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    View and manage registered customer profiles and contact details.
                </p>
            </header>
            <CustomersContainer />
        </div>
    )
}
