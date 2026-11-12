"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/admin/dashboard/stat-card";
import { CalendarCheck, CalendarDays, Wallet, CircleCheck } from "lucide-react";
import { fetchPaymentTotals } from "@/lib/services/payments/paymentsData.service";
import { fetchBusinessToday } from "@/lib/services/settings/bookingPolicy";
import { supabase } from "@/lib/supabase";
import {
  fetchDashboardCardStats,
} from "@/lib/services/dashboard/dashboardCardStats.service";

export default function DashboardStats() {
  const [todayBookingsCount, setTodayBookingsCount] = useState(0);
  const [yesterdayBookingsCount, setYesterdayBookingsCount] = useState(0);
  const [upcomingBookingsCount, setUpcomingBookingsCount] = useState(0);
  // Money actually taken today (the Payments close-out), split QR Ph online / cash at the desk
  const [collected, setCollected] = useState({ total: 0, cash: 0 });
  const [courtStats, setCourtStats] = useState({
    total: 0,
    occupied: 0,
    available: 0,
  });

  useEffect(() => {
    async function fetchStats() {
      try {
        const stats = await fetchDashboardCardStats();
        setTodayBookingsCount(stats.todayBookingsCount);
        setYesterdayBookingsCount(stats.yesterdayBookingsCount);
        setUpcomingBookingsCount(stats.upcomingBookingsCount);
        const totals = await fetchPaymentTotals(await fetchBusinessToday(supabase));
        if (totals.data) setCollected({ total: totals.data.collected, cash: totals.data.cash });
        setCourtStats(stats.courtStats);
      } catch (err) {
        console.error("Failed to load dashboard statistics:", err);
      }
    }

    fetchStats();
  }, []);

  const bookingDiff = todayBookingsCount - yesterdayBookingsCount;

  const bookingDesc =
    bookingDiff === 0
      ? "Same volume as yesterday"
      : `${bookingDiff > 0 ? "+" : ""}${bookingDiff} booking${Math.abs(bookingDiff) === 1 ? "" : "s"} vs yesterday`;

  const stats = [
    {
      title: "Bookings today",
      value: todayBookingsCount,
      description: bookingDesc,
      icon: CalendarCheck,
      trendType: bookingDiff > 0 ? ("positive" as const) : bookingDiff < 0 ? ("negative" as const) : ("neutral" as const),
    },
    {
      title: "Collected today",
      value: `₱${collected.total.toLocaleString()}`,
      description: `QR Ph ₱${(collected.total - collected.cash).toLocaleString()} · Cash ₱${collected.cash.toLocaleString()}`,
      icon: Wallet,
      trendType: "neutral" as const,
    },
    {
      title: "In play now",
      value: `${courtStats.occupied} / ${courtStats.available}`,
      description: `${courtStats.available - courtStats.occupied} free right now${courtStats.total > courtStats.available ? ` · ${courtStats.total - courtStats.available} closed` : ""}`,
      icon: CircleCheck,
      trendType: "neutral" as const,
    },
    {
      title: "Upcoming (7 days)",
      value: upcomingBookingsCount,
      description: "Confirmed bookings this week",
      icon: CalendarDays,
      trendType: "neutral" as const,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.title} {...stat} />
      ))}
    </div>
  );
}
