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
} from "@/lib/services/dashboard.service";

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
      ? `+${bookingDiff} from yesterday`
      : bookingDiff < 0
        ? `${bookingDiff} from yesterday`
        : "Same as yesterday";

  let revDesc = "0% from yesterday";
  if (revYesterday === 0) {
    revDesc = revToday > 0 ? "+100% from yesterday" : "No revenue recorded yesterday";
  } else {
    const pct = Math.round(((revToday - revYesterday) / revYesterday) * 100);
    revDesc = pct >= 0 ? `+${pct}% from yesterday` : `${pct}% from yesterday`;
  }

  const stats = [
    {
      title: "Today's Bookings",
      value: todayBookingsCount,
      description: bookingDesc,
      icon: CalendarCheck,
    },
    {
      title: "Upcoming Bookings",
      value: upcomingBookingsCount,
      description: "Scheduled for next 7 days",
      icon: CalendarDays,
    },
    {
      title: "Today's Revenue",
      value: `₱${revToday.toLocaleString()}`,
      description: revDesc,
      icon: PhilippinePeso,
    },
    {
      title: "Available Courts",
      value: `${courtStats.available} / ${courtStats.total}`,
      description: `${courtStats.occupied} court${courtStats.occupied === 1 ? "" : "s"} currently occupied`,
      icon: CircleCheck,
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

