import { Customer } from "@/lib/services/customers/customersTypes";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, SearchX, Mail, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface CustomersTableProps {
  customers: Customer[];
  loading?: boolean;
  searchQuery?: string;
  onClearSearch?: () => void;
}

const getInitials = (name?: string) => {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const CustomersTable = ({
  customers,
  loading,
  searchQuery,
  onClearSearch,
}: CustomersTableProps) => {
  const formatDate = (dateString?: string) => {
    if (!dateString) return "—";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "—";
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
    } catch {
      return "—";
    }
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden shadow-xs">
      {/* Mobile Adaptive Customer Cards (< sm) */}
      <div className="sm:hidden divide-y divide-border/60">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 space-y-2.5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-3.5 w-44" />
            </div>
          ))
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
            <Users className="size-8 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">
              {searchQuery ? "No matching customers found" : "No registered customers yet"}
            </p>
            {searchQuery && onClearSearch && (
              <Button variant="outline" size="sm" onClick={onClearSearch} className="mt-2 text-xs">
                Reset search
              </Button>
            )}
          </div>
        ) : (
          customers.map((customer) => (
            <div key={customer.id} className="p-4 space-y-2.5 bg-card hover:bg-muted/15 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary select-none">
                    {getInitials(customer.full_name)}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">
                      {customer.full_name?.trim() || "Unnamed Customer"}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Joined {formatDate(customer.created_at)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 pt-1 text-xs">
                <div className="flex items-center gap-2 text-foreground font-medium">
                  <Mail className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{customer.email?.trim() || "No email"}</span>
                </div>
                {customer.phone?.trim() && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="size-3.5 text-muted-foreground shrink-0" />
                    <span>{customer.phone.trim()}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop High-Density Table (>= sm) */}
      <div className="hidden sm:block overflow-y-auto max-h-[500px]">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10 border-b">
            <TableRow className="hover:bg-transparent">
              <TableHead className="bg-card w-[320px]">Customer</TableHead>
              <TableHead className="bg-card">Contact</TableHead>
              <TableHead className="text-right bg-card">Registered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-4 w-24 ml-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto py-6">
                    <div className="rounded-full bg-muted p-3">
                      {searchQuery ? (
                        <SearchX className="h-6 w-6 text-muted-foreground" />
                      ) : (
                        <Users className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-base font-semibold">
                      {searchQuery ? "No matching customers found" : "No registered customers yet"}
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      {searchQuery
                        ? `We couldn't find any customers matching "${searchQuery}". Check the spelling or reset your search.`
                        : "Customer records will appear here as soon as players create an account or book a court."}
                    </p>
                    {searchQuery && onClearSearch && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onClearSearch}
                        className="mt-2"
                      >
                        Reset search
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id} className="transition-colors hover:bg-muted/50">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary select-none">
                        {getInitials(customer.full_name)}
                      </div>
                      <span className="font-medium text-foreground truncate">
                        {customer.full_name?.trim() || "Unnamed Customer"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-sm text-foreground">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{customer.email?.trim() || "No email provided"}</span>
                      </div>
                      {customer.phone?.trim() ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span>{customer.phone.trim()}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/60 italic">
                          No phone provided
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground whitespace-nowrap text-sm font-medium">
                    {formatDate(customer.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
