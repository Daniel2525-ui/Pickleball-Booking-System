import DashboardStats from "@/components/admin/dashboard/dashboard-stats";
import TodaysSchedule from "@/components/admin/dashboard/todays-schedule";
import CourtStatus from "@/components/admin/dashboard/court-status";
import BookingOverview from "@/components/admin/dashboard/booking-overview";
import RecentBookings from "@/components/admin/dashboard/recent-bookings";
import AttentionAlert from "@/components/admin/dashboard/attention-alert";
import DashboardClock from "@/components/admin/dashboard/dashboard-clock";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AdminPageHeader } from "@/components/admin/page-header";
import TodayTimeline from "@/components/admin/dashboard/today-timeline";

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
      <AdminPageHeader
        eyebrow={<span aria-hidden>{roleWord} dashboard</span>}
        title={<><span className="sr-only">{roleWord} Dashboard · </span>{currentDate.replace(/, \d{4}$/, "")}</>}
        description={<DashboardClock date={currentDate} timeOnly />}
      >
        <Link href="/#booking" target="_blank" className={buttonVariants({ variant: "outline", className: "h-10 font-semibold" })}>
          Open booking page<span className="sr-only"> (opens in a new tab)</span>
        </Link>
        <Link href="/admin/bookings?new=walkin" className={buttonVariants({ className: "h-10 gap-1.5 font-semibold" })}>
          <Plus className="size-4" aria-hidden />
          New walk-in
        </Link>
      </AdminPageHeader>

      <DashboardStats />

      <CourtStatus />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <TodayTimeline />
        <section aria-labelledby="needs-you" className="rounded-2xl border bg-card p-5 flex flex-col gap-3">
          <h2 id="needs-you" className="text-lg font-bold">Needs you</h2>
          <AttentionAlert kind="collect" />
          <AttentionAlert kind="refunds" />
          <p className="text-sm text-muted-foreground">Money to collect at the desk and refunds owed show up here as they happen.</p>
        </section>
      </div>

      <TodaysSchedule />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <BookingOverview className="lg:col-span-2" />
        <RecentBookings />
      </div>
    </div>
  );
}
