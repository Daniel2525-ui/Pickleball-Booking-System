import {
  DashboardStats,
  TodaysSchedule,
  CourtStatus,
  BookingOverview,
  RecentBookings,
} from "@/components/admin/dashboard";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-4 lg:p-8 w-full max-w-7xl mx-auto overflow-visible">
      {/* Page Header */}
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your pickleball facility
        </p>
      </header>

      {/* Statistic Cards */}
      <DashboardStats />

      {/* Today's Schedule + Court Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TodaysSchedule className="lg:col-span-2" />
        <CourtStatus />
      </div>

      {/* Booking Overview + Recent Bookings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <BookingOverview className="lg:col-span-2" />
        <RecentBookings />
      </div>
    </div>
  );
}
