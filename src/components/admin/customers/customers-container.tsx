"use client";

import { useState, useEffect } from "react";
import { Search, X, Users, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Customer } from "@/lib/services/customers/customersTypes";
import { CustomersTable } from "./customers-table";
import { fetchCustomers } from "@/lib/services/customers/fetchCustomers.service";
import StatCard from "@/components/admin/dashboard/stat-card";

export default function CustomersContainer() {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCustomers = async () => {
      setLoading(true);
      const { data } = await fetchCustomers();

      if (data) {
        setCustomers(data);
      }

      setLoading(false);
    };

    loadCustomers();
  }, []);

  const normalizedSearch = search.trim().toLowerCase();

  const filtered = customers.filter((customer) => {
    if (!normalizedSearch) return true;

    const nameMatch = customer.full_name?.toLowerCase().includes(normalizedSearch) ?? false;
    const emailMatch = customer.email?.toLowerCase().includes(normalizedSearch) ?? false;
    const phoneMatch = customer.phone?.toLowerCase().includes(normalizedSearch) ?? false;

    return nameMatch || emailMatch || phoneMatch;
  });

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  const currentMonthName = currentDate.toLocaleDateString("en-US", { month: "long" });

  const counts = {
    total: customers.length,
    newThisMonth: customers.filter((customer) => {
      const joinedDate = new Date(customer.created_at);
      return joinedDate.getMonth() === currentMonth && joinedDate.getFullYear() === currentYear;
    }).length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="Total Customers"
          value={loading ? "—" : counts.total}
          description="Total registered customer accounts in the system"
          icon={Users}
        />
        <StatCard
          title="New This Month"
          value={loading ? "—" : counts.newThisMonth}
          description={`Accounts registered in ${currentMonthName} ${currentYear}`}
          icon={UserPlus}
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, email, or phone..."
            aria-label="Search customers by name, email, or phone"
            className="pl-9 pr-8 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors size-8 flex items-center justify-center rounded-lg"
              aria-label="Clear customer search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {search && (
          <div className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {customers.length}{" "}
            {customers.length === 1 ? "customer" : "customers"}
          </div>
        )}
      </div>

      <CustomersTable
        customers={filtered}
        loading={loading}
        searchQuery={search}
        onClearSearch={() => setSearch("")}
      />
    </div>
  );
}
