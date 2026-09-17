import { Customer } from "@/lib/services/customers/customersTypes";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEffect, useState } from "react";

interface CustomersTableProps {
  customers: Customer[];
}

export function CustomersTable({ customers }: CustomersTableProps) {

  const [customerData, setCustomerData] = useState<Customer[]>([])

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(dateString));
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead className="text-right">Total Bookings</TableHead>
            <TableHead className="text-right">Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer) => (
            <TableRow key={customer.id}>
              <TableCell className="font-medium">{customer.name}</TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm">{customer.email}</span>
                  <span className="text-xs text-muted-foreground">{customer.phone}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">{customer.totalBookings}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatDate(customer.joinedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
