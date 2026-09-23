import PaymentsContainer from "@/components/admin/payments/payments-container";

export default function PaymentsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-8 w-full max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and track all payment transactions.
          </p>
        </div>
      </div>

      <PaymentsContainer />
    </div>
  );
}
