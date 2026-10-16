import {
  DashboardStats,
  TodaysSchedule,
  CourtStatus,
  BookingOverview,
  RecentBookings,
} from "@/components/admin/dashboard";
import { Clock } from "lucide-react";

export const metadata = {
  title: "Admin Dashboard | Crosshair Dinkers",
  description: "Facility operations, court schedules, and real-time reservation metrics.",
};

export default function DashboardPage() {
  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-8 pb-4 lg:pb-8 pt-0 w-full max-w-7xl mx-auto overflow-visible">
      {/* Dashboard Operational Header */}
      <header className="sticky top-14 z-20 bg-background/95 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-6 pb-4 sm:pt-7 sm:pb-4 border-b border-border/60 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Admin Dashboard
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Court availability, daily booking schedules, and facility activity at Crosshair Dinkers.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto text-xs font-medium text-muted-foreground bg-muted/40 border border-border px-3 py-1.5 rounded-lg shadow-2xs">
          <Clock className="size-3.5 text-primary shrink-0" />
          <span>{currentDate}</span>
        </div>
      </header>

      {/* KPI Cards Strip */}
      <DashboardStats />

      {/* Primary Operations: Today's Schedule + Real-time Court Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TodaysSchedule className="lg:col-span-2" />
        <CourtStatus />
      </div>

      {/* Analytical Trends: Weekly Volume + Recent Bookings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <BookingOverview className="lg:col-span-2" />
        <RecentBookings />
      </div>
    </div>
  );
}
