import StatCard from "@/components/admin/dashboard/stat-card";
import { CalendarCheck, CalendarDays, PhilippinePeso, CircleCheck } from "lucide-react";

const stats = [
  {
    title: "Today's Bookings",
    value: "12",
    description: "+3 from yesterday",
    icon: CalendarCheck,
  },
  {
    title: "Upcoming Bookings",
    value: "18",
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

export default function DashboardStats() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.title} {...stat} />
      ))}
    </div>
  );
}
