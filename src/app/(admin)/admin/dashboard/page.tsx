import DashboardStats from "@/components/admin/dashboard/dashboard-stats";
import TodaysSchedule from "@/components/admin/dashboard/todays-schedule";
import CourtStatus from "@/components/admin/dashboard/court-status";
import BookingOverview from "@/components/admin/dashboard/booking-overview";
import RecentBookings from "@/components/admin/dashboard/recent-bookings";
import AttentionAlert from "@/components/admin/dashboard/attention-alert";
import DashboardClock from "@/components/admin/dashboard/dashboard-clock";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { VENUE_NAME } from "@/lib/brand";

export const metadata = {
  title: "Dashboard",
  description: "Facility operations, court schedules, and real-time reservation metrics.",
};

export default async function DashboardPage() {
  // Render per request in venue time; a prerendered page would show the deploy day in UTC
  await connection();
  // Admins (owners) and front-desk staff share this page; the heading says which one is signed in
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("is_owner").eq("id", user.id).maybeSingle()
    : { data: null };
  const roleWord = profile?.is_owner ? "Admin" : "Staff";
  const currentDate = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
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
            {roleWord} Dashboard
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Court availability, daily booking schedules, and facility activity at {VENUE_NAME}.
          </p>
        </div>

        <DashboardClock date={currentDate} />
      </header>

      <AttentionAlert kind="gcash" />
      <AttentionAlert kind="refunds" />
      <AttentionAlert kind="collect" />

      {/* KPI Cards Strip */}
      <DashboardStats />

      {/* Primary Operations: every court at a glance, then today's schedule at full width */}
      <CourtStatus />
      <TodaysSchedule />

      {/* Analytical Trends: Weekly Volume + Recent Bookings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <BookingOverview className="lg:col-span-2" />
        <RecentBookings />
      </div>
    </div>
  );
}
