import { Customer } from "@/lib/services/customers/customersTypes";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CustomersTableProps {
  customers: Customer[];
  loading?: boolean;
}

export const CustomersTable = ({ customers, loading }: CustomersTableProps) => {
  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(dateString));
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="max-h-[600px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Total Bookings</TableHead>
              <TableHead className="text-right">Joined</TableHead>
            </TableRow>
          </TableHeader>
        <TableBody>
          {loading ? (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-4 w-8 ml-auto" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-4 w-24 ml-auto" />
                  </TableCell>
                </TableRow>
              ))}
            </>
          ) : customers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-64 text-center">
                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="rounded-full bg-muted p-3">
                    <Users className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="text-lg font-semibold">No customers found</div>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    There are no customers matching your search. Customers will appear here once they sign up and book courts.
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell className="font-medium">{customer.full_name}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-sm">{customer.email}</span>
                    <span className="text-xs text-muted-foreground">{customer.phone}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">{customer.totalBookings}</TableCell>
                <TableCell className="text-right text-muted-foreground">
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
}
