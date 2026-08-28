export default function CustomersPage() {
    return (
        <div className="flex flex-col gap-4 p-4 lg:p-8 w-full max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            </div>
            <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-8">
                <div className="flex h-[400px] shrink-0 items-center justify-center rounded-md border border-dashed">
                    <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                        <h3 className="mt-4 text-lg font-semibold">No customers found</h3>
                        <p className="mb-4 mt-2 text-sm text-muted-foreground">
                            Customer accounts and details will appear here.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
