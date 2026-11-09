"use client";

import { useState, useEffect } from "react";
import { Search, X, Users, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Customer } from "@/lib/services/customers/customersTypes";
import { CustomersTable } from "./customers-table";
import { fetchCustomers, CUSTOMERS_PAGE_SIZE } from "@/lib/services/customers/fetchCustomers.service";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { EditCustomerModal } from "./edit-customer-modal";
import { CustomerNoteModal } from "./customer-note-modal";
import StatCard from "@/components/admin/dashboard/stat-card";

export default function CustomersContainer() {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0); // matches for the current search
  const [allTotal, setAllTotal] = useState(0); // every customer, for the summary card
  const [newThisMonth, setNewThisMonth] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [noting, setNoting] = useState<Customer | null>(null);
  // Bumped after an edit so the list reloads
  const [version, setVersion] = useState(0);

  // Search runs on the server across every customer, not just the loaded page
  useEffect(() => {
    let ignore = false;
    fetchCustomers(search).then(({ data, total, newThisMonth, error }) => {
      if (ignore) return;
      if (error) toast.error("Failed to load customers.");
      setCustomers(data);
      setTotal(total);
      if (!search) setAllTotal(total);
      setNewThisMonth(newThisMonth);
      setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [search, version]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data, error } = await fetchCustomers(search, customers.length);
    if (error) toast.error("Failed to load more customers.");
    else setCustomers((prev) => [...prev, ...data]);
    setLoadingMore(false);
  };

  const currentMonthName = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="Total Customers"
          value={loading ? "—" : allTotal}
          description="Members and walk-in records (staff accounts excluded)"
          icon={Users}
        />
        <StatCard
          title="New This Month"
          value={loading ? "—" : newThisMonth}
          description={`Added in ${currentMonthName}`}
          icon={UserPlus}
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, email, phone, or note..."
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
            <span className="font-semibold text-foreground">{total}</span> {total === 1 ? "match" : "matches"}
          </div>
        )}
      </div>

      <CustomersTable
        customers={customers}
        loading={loading}
        searchQuery={search}
        onEdit={setEditing}
        onNote={setNoting}
      />

      {customers.length < total && customers.length >= CUSTOMERS_PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load More Customers"}
          </Button>
        </div>
      )}

      <EditCustomerModal
        customer={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setVersion((v) => v + 1)}
      />
      <CustomerNoteModal
        customer={noting}
        onClose={() => setNoting(null)}
        onSaved={() => setVersion((v) => v + 1)}
      />
    </div>
  );
}
