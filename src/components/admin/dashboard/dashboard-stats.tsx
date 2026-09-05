"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/admin/dashboard/stat-card";
import { CalendarCheck, CalendarDays, PhilippinePeso, CircleCheck } from "lucide-react";
import { bookingsToday, upcomingBookings } from "@/lib/services/dashboard.service";

export default function DashboardStats() {
  const [todayBookingsCount, setTodayBookingsCount] = useState(0);
  const [upcomingBookingsCount, setUpcomingBookingsCount] = useState(0)

  useEffect(() => {
    async function fetchStats() {
      const today = await bookingsToday();
      const upcoming = await upcomingBookings();

      setTodayBookingsCount(today);
      setUpcomingBookingsCount(upcoming)
    }

    fetchStats();
  }, []);

  const stats = [
    {
      title: "Today's Bookings",
      value: todayBookingsCount,
      description: "+3 from yesterday",
      icon: CalendarCheck,
    },
    {
      title: "Upcoming Bookings",
      value: upcomingBookingsCount,
      description: "Next 7 days",
      icon: CalendarDays,
    },
    {
      title: "Today's Revenue",
      value: "₱5,500",
      description: "+12% from yesterday",
      icon: PhilippinePeso,
    },
    {
      title: "Available Courts",
      value: "4 / 6",
      description: "2 courts currently occupied",
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

