"use client";

import { useState, useEffect } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchMockCustomers } from "@/lib/services/customers/customersData";
import { Customer } from "@/lib/services/customers/customersTypes";
import { CustomersTable } from "./customers-table";

export default function CustomersContainer() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCustomers = async () => {
      setLoading(true);
      const { data } = await fetchMockCustomers();
      if (data) {
        setCustomers(data);
      }
      setLoading(false);
    };

    loadCustomers();
  }, []);

  const filtered = customers.filter((customer) => {
    const matchesSearch =
      !search ||
      customer.name.toLowerCase().includes(search.toLowerCase()) ||
      customer.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || customer.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  const counts = {
    total: customers.length,
    newThisMonth: customers.filter((c) => {
      const joinedDate = new Date(c.joinedAt);
      return joinedDate.getMonth() === currentMonth && joinedDate.getFullYear() === currentYear;
    }).length,
    repeat: customers.filter((c) => c.totalBookings > 1).length,
  };

  const stats = [
    { label: "Total Customers", value: counts.total, color: "text-foreground" },
    { label: "New This Month", value: counts.newThisMonth, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Repeat Customers", value: counts.repeat, color: "text-blue-600 dark:text-blue-400" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card px-4 py-3 shadow-sm">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers by name or email..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "All")}>
          <SelectTrigger className="w-full sm:w-[160px] bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground text-sm">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Fetching customers...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm">
          No customers matched your search.
        </div>
      ) : customers.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm">
          No customers signed in yet.
        </div>
      ) : (
        <CustomersTable customers={filtered} />
      )}
    </div>
  );
}
