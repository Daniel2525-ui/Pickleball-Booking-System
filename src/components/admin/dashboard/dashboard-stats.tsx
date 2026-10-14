"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/admin/dashboard/stat-card";
import { CalendarCheck, CalendarDays, PhilippinePeso, CircleCheck } from "lucide-react";
import {
  bookingsToday,
  bookingsYesterday,
  upcomingBookings,
  revenueToday,
  revenueYesterday,
  availableCourts,
} from "@/lib/services/dashboard/dashboardCardStats.service";

export default function DashboardStats() {
  const [todayBookingsCount, setTodayBookingsCount] = useState(0);
  const [yesterdayBookingsCount, setYesterdayBookingsCount] = useState(0);
  const [upcomingBookingsCount, setUpcomingBookingsCount] = useState(0);
  const [revToday, setRevToday] = useState(0);
  const [revYesterday, setRevYesterday] = useState(0);
  const [courtStats, setCourtStats] = useState({
    total: 0,
    occupied: 0,
    available: 0,
  });

  useEffect(() => {
    async function fetchStats() {
      const today = await bookingsToday();
      const yesterdayBookings = await bookingsYesterday();
      const upcoming = await upcomingBookings();
      const revenueTodayAmount = await revenueToday();
      const revenueYesterdayAmount = await revenueYesterday();
      const getCourtToday = await availableCourts();

      setTodayBookingsCount(today);
      setYesterdayBookingsCount(yesterdayBookings);
      setUpcomingBookingsCount(upcoming);
      setRevToday(revenueTodayAmount);
      setRevYesterday(revenueYesterdayAmount);
      setCourtStats(getCourtToday);
    }

    fetchStats();
  }, []);

  const bookingDiff = todayBookingsCount - yesterdayBookingsCount;
  const bookingDesc =
    bookingDiff > 0
      ? `+${bookingDiff} booking${bookingDiff === 1 ? "" : "s"} vs yesterday`
      : bookingDiff < 0
      ? `${bookingDiff} booking${bookingDiff === -1 ? "" : "s"} vs yesterday`
      : `Same volume as yesterday`;

  const revDiff = revToday - revYesterday;
  const revDesc =
    revYesterday === 0
      ? revToday > 0
        ? "First revenue recorded today"
        : "No revenue recorded yesterday"
      : revDiff > 0
      ? `+₱${revDiff.toLocaleString()} vs yesterday`
      : revDiff < 0
      ? `-₱${Math.abs(revDiff).toLocaleString()} vs yesterday`
      : `Same revenue as yesterday`;

  const stats = [
    {
      title: "Bookings Today",
      value: todayBookingsCount,
      description: bookingDesc,
      icon: CalendarCheck,
      trendType: bookingDiff > 0 ? ("positive" as const) : bookingDiff < 0 ? ("negative" as const) : ("neutral" as const),
    },
    {
      title: "Upcoming (7 Days)",
      value: upcomingBookingsCount,
      description: "Confirmed player reservations",
      icon: CalendarDays,
      trendType: "neutral" as const,
    },
    {
      title: "Revenue Today",
      value: `₱${revToday.toLocaleString()}`,
      description: revDesc,
      icon: PhilippinePeso,
      trendType: revDiff > 0 ? ("positive" as const) : revDiff < 0 ? ("negative" as const) : ("neutral" as const),
    },
    {
      title: "Active Courts",
      value: `${courtStats.available} / ${courtStats.total}`,
      description: `${courtStats.occupied} of ${courtStats.total} courts currently in play`,
      icon: CircleCheck,
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
